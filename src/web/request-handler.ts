import type { Logger } from "pino";
import type { GigFinderApplication } from "../core/application";
import { parseAgentModelId } from "../core/application-settings";
import { toWebError } from "./error-response";
import { WebRequestError, type AgentApi } from "./agent-handler";
import type { StaticFileHandler } from "./static-files";
import { documentIdFromIdentifier } from "../core/documents";
import type { ReadableDocument } from "../core/document-reader";

const agentIdleTimeoutSeconds = 120;
const documentUploadTimeoutSeconds = 60;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export interface WebHandlerDependencies {
  gigFinder: GigFinderApplication;
  agentApi: AgentApi;
  uploadHandler(request: Request): Promise<Response>;
  discardStagedDocument(reference: string): boolean;
  requestLogger(requestId: string): Logger;
  healthCheck?: () => {
    ok: boolean;
    revision: string;
    integrity: string;
    foreignKeyViolations: number;
  };
  staticFiles?: StaticFileHandler;
}

interface RequestTimeoutController {
  timeout(request: Request, seconds: number): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface ManagedDocumentRoute {
  reference: string;
  version: number;
  download: boolean;
}

export function parseManagedDocumentRoute(pathname: string): ManagedDocumentRoute | null {
  const match = pathname.match(
    /^\/api\/documents\/([^/]+)\/versions\/([^/]+)(\/download)?$/,
  );
  if (!match) return null;
  let reference: string;
  try {
    reference = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  const versionText = match[2] ?? "";
  if (!/^[1-9]\d*$/.test(versionText)) return null;
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || !documentIdFromIdentifier(reference)) {
    return null;
  }
  return { reference, version, download: match[3] === "/download" };
}

export function documentDownloadFilename(
  displayName: string,
  mediaType: ReadableDocument["mediaType"],
) {
  const stem = displayName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.(?:md|txt)$/i, "")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "-")
    .replace(/^[ ._-]+/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120) || "Document";
  return `${stem}.${mediaType === "text/markdown" ? "md" : "txt"}`;
}

function managedDocumentResponse(document: ReadableDocument, download: boolean) {
  if (download) {
    const filename = documentDownloadFilename(document.displayName, document.mediaType);
    return new Response(document.content, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": `${document.mediaType}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  return json({
    reference: document.reference,
    storage: document.storage,
    displayName: document.displayName,
    documentType: document.documentType,
    mediaType: document.mediaType,
    version: document.version,
    currentVersion: document.currentVersion,
    content: document.content,
  });
}

async function updateAgentModel(
  request: Request,
  gigFinder: GigFinderApplication,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    throw new WebRequestError("Request body must be valid JSON.", 400, {
      cause: error,
    });
  }
  const modelId = parseAgentModelId(
    isRecord(body) ? body.modelId : undefined,
  );
  return gigFinder.settings.setAgentModel(modelId);
}

export function createWebHandler({gigFinder,agentApi,uploadHandler,discardStagedDocument,requestLogger,healthCheck,staticFiles}:WebHandlerDependencies) {
  return async function fetch(request:Request,server:RequestTimeoutController) {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const log = requestLogger(requestId);
    const url = new URL(request.url);
    if (url.pathname === "/api/agent/messages") {
      server.timeout(request, agentIdleTimeoutSeconds);
    } else if (url.pathname === "/api/agent/documents") {
      server.timeout(request, documentUploadTimeoutSeconds);
    }
    log.debug({
      event: "http.request",
      request: {
        method: request.method,
        path: url.pathname,
        contentLength: Number(request.headers.get("content-length") ?? 0),
        userAgent: request.headers.get("user-agent"),
      },
      ...(url.pathname === "/api/agent/messages"
        ? { idleTimeoutSeconds: agentIdleTimeoutSeconds }
        : url.pathname === "/api/agent/documents"
          ? { idleTimeoutSeconds: documentUploadTimeoutSeconds }
        : {}),
    }, "Received HTTP request");

    let response: Response;
    try {
      if (url.pathname === "/healthz") {
        if (request.method !== "GET") {
          response = json({ error: "Method not allowed" }, 405);
        } else if (!healthCheck) {
          response = json({ status: "unavailable" }, 503);
        } else {
          const health = healthCheck();
          response = json({
            status: health.ok ? "ok" : "error",
            revision: health.revision,
            database: {
              integrity: health.integrity,
              foreignKeyViolations: health.foreignKeyViolations,
            },
          }, health.ok ? 200 : 503);
        }
      } else if (url.pathname === "/api/agent/messages") {
        response = request.method === "POST"
          ? await agentApi.messages(new Request(request, { headers: new Headers([...request.headers, ["x-request-id", requestId]]) }))
          : json({ error: "Method not allowed" }, 405);
      } else if (url.pathname === "/api/agent/conversations") {
        response = request.method === "GET"
          ? agentApi.list()
          : json({ error: "Method not allowed" }, 405);
      } else if (url.pathname.startsWith("/api/agent/conversations/")) {
        response = request.method === "GET"
          ? agentApi.load(decodeURIComponent(url.pathname.slice("/api/agent/conversations/".length)))
          : json({ error: "Method not allowed" }, 405);
      } else if (url.pathname === "/api/agent/documents") {
        response = request.method === "POST"
          ? await uploadHandler(request)
          : json({ error: "Method not allowed" }, 405);
      } else if (url.pathname.startsWith("/api/agent/documents/")) {
        const reference = decodeURIComponent(
          url.pathname.slice("/api/agent/documents/".length),
        );
        response = request.method === "DELETE"
          ? discardStagedDocument(reference)
            ? new Response(null, { status: 204 })
            : json({ error: "Staged document not found" }, 404)
          : json({ error: "Method not allowed" }, 405);
      } else if (url.pathname.startsWith("/api/documents/")) {
        const documentRoute = parseManagedDocumentRoute(url.pathname);
        if (!documentRoute) {
          response = json({ error: "Invalid document reference or version" }, 400);
        } else if (request.method !== "GET") {
          response = json({ error: "Method not allowed" }, 405);
        } else {
          const result = await gigFinder.documentReader.get(
            documentRoute.reference,
            documentRoute.version,
          );
          response = result.status === "ok"
              && result.record.storage === "managed"
              && result.record.version === documentRoute.version
            ? managedDocumentResponse(result.record, documentRoute.download)
            : json({ error: "Document version not found" }, 404);
        }
      } else if (url.pathname === "/api/settings/agent-model") {
        response = request.method === "GET"
          ? json(gigFinder.settings.get())
          : request.method === "PUT"
            ? json(await updateAgentModel(request, gigFinder))
            : json({ error: "Method not allowed" }, 405);
      } else if (request.method !== "GET") {
        response = json({ error: "Read-only API" }, 405);
      } else if (url.pathname === "/api/gigs") {
        response = json(gigFinder.gigs.list());
      } else if (url.pathname === "/api/people") {
        response = json(gigFinder.people.list());
      } else if (url.pathname === "/api/tasks") {
        response = json(gigFinder.tasks.list());
      } else {
        const match = url.pathname.match(/^\/api\/gigs\/([^/]+)\/artifacts$/);
        if (match) {
          const id=decodeURIComponent(match[1]??"");const gig=gigFinder.gigs.get(id);
          response = gig?json({jobDescription:await gigFinder.gigs.description(id),sourceUrl:gig.sourceUrl,artifactDirectory:`artifacts/gigs/${id}/`}):json({error:"Gig not found"},404);
        } else {
          response = await staticFiles?.(request) ?? json({ error: "Not found" }, 404);
        }
      }
    } catch (error) {
      log.error({ event: "http.request.failed", err: error }, "HTTP request failed");
      const webError = toWebError(error);
      response = json(webError.body, webError.status);
    }

    response.headers.set("x-request-id", requestId);
    const streaming = url.pathname === "/api/agent/messages"
      && response.headers.get("x-vercel-ai-ui-message-stream") === "v1";
    log.debug({
      event: streaming ? "http.response.started" : "http.response",
      response: { status: response.status },
      streaming,
      latencyMs: Math.round(performance.now() - startedAt),
    }, streaming ? "Started streaming HTTP response" : "Completed HTTP request");
    return response;
  };
}
