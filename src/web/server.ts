import type { Logger } from "pino";
import type { GigFinderApplication } from "../core/src/application";
import { parseAgentModelId } from "../core/src/application-settings";
import { toWebError } from "./error-response";
import { WebRequestError } from "./agent-handler";

const agentIdleTimeoutSeconds = 120;
const documentUploadTimeoutSeconds = 60;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export interface WebHandlerDependencies {
  gigFinder: GigFinderApplication;
  agentHandler(request: Request): Promise<Response>;
  uploadHandler(request: Request): Promise<Response>;
  discardStagedDocument(reference: string): boolean;
  requestLogger(requestId: string): Logger;
}

interface RequestTimeoutController {
  timeout(request: Request, seconds: number): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

export function createWebHandler({gigFinder,agentHandler,uploadHandler,discardStagedDocument,requestLogger}:WebHandlerDependencies) {
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
          ? discardStagedDocument(reference)
            ? new Response(null, { status: 204 })
            : json({ error: "Staged document not found" }, 404)
          : json({ error: "Method not allowed" }, 405);
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
  };
}
