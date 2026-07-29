import path from "node:path";
import { createAgentHandler } from "./agent-handler";
import { toWebError } from "./error-response";
import {
  activeLogFile,
  configuredLogLevel,
  logger,
  requestLogger,
} from "../observability/logger";
import { loadJobSearchProfile } from "../agent/profile-loader";
import { openLocalApplication, resolveJobSearchContext } from "../sqlite/src";
import { registerDevelopmentTelemetry } from "../observability/devtools";
import { managedDocumentContentLimit, StagedDocumentService } from "../core/src";
import { LocalDocumentConverter } from "./document-conversion";
import { createDocumentUploadHandler } from "./document-upload-handler";

const repoRoot = path.resolve(import.meta.dir, "../..");
const devToolsEnabled = await registerDevelopmentTelemetry();
const context = resolveJobSearchContext(repoRoot);
const {application:jobSearch}=openLocalApplication({database:context.database,artifacts:context.artifacts});
const port = Number(process.env.API_PORT ?? 3001);
const agentIdleTimeoutSeconds = 120;
const documentUploadTimeoutSeconds = 60;
const positiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const uploadLimits = {
  maxBytes: positiveInteger(process.env.DOCUMENT_UPLOAD_MAX_BYTES, 10_000_000),
  maxCharacters: positiveInteger(
    process.env.DOCUMENT_EXTRACTION_MAX_CHARACTERS,
    managedDocumentContentLimit,
  ),
  maxPdfPages: positiveInteger(process.env.DOCUMENT_PDF_MAX_PAGES, 100),
};
const stagedDocuments = new StagedDocumentService(
  positiveInteger(process.env.DOCUMENT_STAGE_TTL_MS, 15 * 60 * 1000),
);
const uploadHandler = createDocumentUploadHandler(
  new LocalDocumentConverter(uploadLimits),
  stagedDocuments,
  uploadLimits.maxBytes,
);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const agentHandler = createAgentHandler(
  loadJobSearchProfile(context.profile),
  undefined,
  logger,
  jobSearch.agentContext,
  jobSearch,
  context.actor,
  { contextSearch: jobSearch.contextSearch, stagedDocuments },
);

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request, server) {
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
      if (url.pathname === "/api/agent/messages") {
        response = request.method === "POST"
          ? await agentHandler(new Request(request, { headers: new Headers([...request.headers, ["x-request-id", requestId]]) }))
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
          ? stagedDocuments.discard(reference)
            ? new Response(null, { status: 204 })
            : json({ error: "Staged document not found" }, 404)
          : json({ error: "Method not allowed" }, 405);
      } else if (request.method !== "GET") {
        response = json({ error: "Read-only API" }, 405);
      } else if (url.pathname === "/api/jobs") {
        response = json(jobSearch.jobs.list());
      } else if (url.pathname === "/api/network") {
        response = json(jobSearch.networking.list());
      } else if (url.pathname === "/api/tasks") {
        response = json(jobSearch.tasks.list());
      } else {
        const match = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts$/);
        if (match) {
          const id=decodeURIComponent(match[1]??"");const role=jobSearch.jobs.get(id);
          response = role?json({jobDescription:await jobSearch.jobs.description(id),sourceUrl:role.sourceUrl,roleDirectory:`artifacts/jobs/${id}/`}):json({error:"Role not found"},404);
        } else {
          response = json({ error: "Not found" }, 404);
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
  },
});

logger.info({
  event: "server.started",
  address: `http://127.0.0.1:${port}`,
  logFile: activeLogFile,
  logLevel: configuredLogLevel,
  aiSdkDevTools: devToolsEnabled,
}, "Read-only jobs API listening");
