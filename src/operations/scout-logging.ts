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
  constructor(
    private readonly delegate: GigScoutHttpPort,
    private readonly logger?: ScoutLogger,
  ) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const startedAt = performance.now();
    safeScoutLog(
      this.logger,
      "info",
      {
        event: "scout.http.request_started",
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
          method: request.method,
          url: sanitizedLogText(request.url),
          responseUrl: sanitizedLogText(response.url),
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt),
          headers: sanitizedHeaders(response.headers),
          body: boundedLogValue(response.body),
        },
        "Scout source request completed",
      );
      return response;
    } catch (error) {
      safeScoutLog(
        this.logger,
        "error",
        {
          event: "scout.http.request_failed",
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
