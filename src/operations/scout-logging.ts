import { createHash, randomUUID } from "node:crypto";
import type {
  GigScoutHttpPort,
  HttpRequest,
  HttpResponse,
} from "../core/scout/sourcing/ports";

export interface ScoutLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}

const secretKey = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|proxy-authorization|access[-_]?token|refresh[-_]?token|session[-_]?token|csrf[-_]?token|client[-_]?secret|password|token)$/i;

export function sanitizedLogData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizedLogData);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : sanitizedLogData(item),
      ]),
    );
  return value;
}

export function sanitizedLogText(value: string) {
  try {
    return JSON.stringify(sanitizedLogData(JSON.parse(value)));
  } catch {
    return value
      .replace(/(bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(
        /(["'](?:access[-_]?token|refresh[-_]?token|session[-_]?token|csrf[-_]?token|api[-_]?key|client[-_]?secret|password|token)["']\s*[:=]\s*["'])[^"']*/gi,
        "$1[REDACTED]",
      )
      .replace(
        /(<input\b(?=[^>]*\bname=["'](?:password|access[-_]?token|refresh[-_]?token|session[-_]?token|csrf[-_]?token|api[-_]?key|client[-_]?secret|token)["'])[^>]*\bvalue=["'])[^"']*/gi,
        "$1[REDACTED]",
      )
      .replace(
        /(<input\b(?=[^>]*\bname=(?:password|access[-_]?token|refresh[-_]?token|session[-_]?token|csrf[-_]?token|api[-_]?key|client[-_]?secret|token)(?:\s|>))[^>]*\bvalue=)[^\s>]+/gi,
        "$1[REDACTED]",
      )
      .replace(
        /([?&](?:access_token|refresh_token|session_token|token|api_key|apikey)=)[^&#]*/gi,
        "$1[REDACTED]",
      )
      .replace(
        /((?:^|&)(?:access_token|refresh_token|session_token|token|api_key|apikey)=)[^&]*/gi,
        "$1[REDACTED]",
      );
  }
}

export function boundedLogValue(value: string, limit = 16_384) {
  const sanitized = sanitizedLogText(value);
  return sanitized.length <= limit
    ? { value: sanitized, truncated: false, originalLength: value.length }
    : {
        value: sanitized.slice(0, limit),
        truncated: true,
        originalLength: value.length,
      };
}

export function sanitizedHeaders(headers: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      secretKey.test(key) ? "[REDACTED]" : sanitizedLogText(value),
    ]),
  );
}

function responseDiagnostics(response: HttpResponse) {
  const contentType = response.headers["content-type"] ?? null;
  const declaredLength = response.headers["content-length"] ?? null;
  const bodyPrefix = boundedLogValue(response.body.slice(0, 512), 512);
  return {
    status: response.status,
    responseStatus: response.status,
    responseUrl: sanitizedLogText(response.url),
    responseContentType: contentType,
    responseDeclaredLength: declaredLength,
    responseBodyBytes: Buffer.byteLength(response.body),
    responseBodySha256: createHash("sha256").update(response.body).digest("hex"),
    responseBodyPrefix: bodyPrefix,
  };
}

export function safeScoutLog(
  logger: ScoutLogger | undefined,
  level: "info" | "error",
  fields: Record<string, unknown>,
  message: string,
) {
  try {
    logger?.[level](fields, message);
  } catch {
    // Observability must never alter queue or domain outcomes.
  }
}

export class LoggingScoutHttpPort implements GigScoutHttpPort {
  private readonly logFullResponses: boolean;

  constructor(
    private readonly delegate: GigScoutHttpPort,
    private readonly logger?: ScoutLogger,
    options: { logFullResponses?: boolean } = {},
  ) {
    this.logFullResponses =
      options.logFullResponses ??
      process.env.GIG_FINDER_SCOUT_LOG_FULL_RESPONSES === "true";
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const startedAt = performance.now();
    const requestId = randomUUID();
    safeScoutLog(
      this.logger,
      "info",
      {
        event: "scout.http.request_started",
        requestId,
        context: sanitizedLogData(request.context ?? {}),
        method: request.method,
        url: sanitizedLogText(request.url),
        headers: sanitizedHeaders(request.headers),
        body: boundedLogValue(request.body ?? ""),
        timeoutMs: request.timeoutMs,
        maxResponseBytes: request.maxResponseBytes,
      },
      "Scout source request started",
    );
    try {
      const response = await this.delegate.request(request);
      safeScoutLog(
        this.logger,
        "info",
        {
          event: "scout.http.request_completed",
          requestId,
          context: sanitizedLogData(request.context ?? {}),
          method: request.method,
          url: sanitizedLogText(request.url),
          durationMs: Math.round(performance.now() - startedAt),
          headers: sanitizedHeaders(response.headers),
          body: boundedLogValue(response.body),
          ...(this.logFullResponses
            ? { fullResponse: boundedLogValue(response.body, response.body.length) }
            : {}),
          ...responseDiagnostics(response),
        },
        "Scout source request completed",
      );
      return { ...response, requestId };
    } catch (error) {
      safeScoutLog(
        this.logger,
        "error",
        {
          event: "scout.http.request_failed",
          requestId,
          context: sanitizedLogData(request.context ?? {}),
          method: request.method,
          url: sanitizedLogText(request.url),
          durationMs: Math.round(performance.now() - startedAt),
          errorCode:
            error instanceof Error
              ? sanitizedLogText(error.message).slice(0, 200)
              : "unknown",
        },
        "Scout source request failed",
      );
      throw error;
    }
  }
}
