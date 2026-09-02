import type { Logger } from "pino";
import type { GigFinderApplication } from "../core/application";
import { parseAgentModelId } from "../core/application-settings";
import { toWebError } from "./error-response";
import { WebRequestError, type AgentApi } from "./agent-handler";
import type { StaticFileHandler } from "./static-files";
import type { ReadableDocument } from "../core/document-reader";
import type { ScoutRunService } from "../core/scout/engine/runs";
import type {ScoutPositionService} from "../core/scout/engine/scout-position-service";

const agentIdleTimeoutSeconds = 120;
const documentUploadTimeoutSeconds = 60;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const trustedUserActor="User";
const scoutMutation=<T>(operation:()=>T)=>{try{return operation();}catch(reason){const message=reason instanceof Error?reason.message:"Invalid Scout position request.";throw new WebRequestError(message,message.includes("revised")?409:422);}};
const scoutDecisionFields = new Set([
  "changeId",
  "action",
  "note",
  "reviewAt",
  "expectedStateRevision",
  "descriptionId",
  "relevanceEvaluationId",
  "candidateMatchEvaluationId",
  "resolution",
]);

async function scoutDecisionBody(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    throw new WebRequestError("Request body must be valid JSON.", 422, {
      cause: error,
    });
  }
  if (!isRecord(body)) {
    throw new WebRequestError("Scout position decision must be an object.", 422);
  }
  if (Object.keys(body).some(field => !scoutDecisionFields.has(field))) {
    throw new WebRequestError(
      "Scout position decision accepts only reviewed decision and resolution fields.",
      422,
    );
  }
  return body;
}

async function scoutDecisionResponse(
  outcome: unknown,
  gigFinder: GigFinderApplication,
): Promise<unknown> {
  if (!isRecord(outcome)
    || (outcome.status !== "resolution_required" && outcome.status !== "resolution_stale")
    || !Array.isArray(outcome.candidates)) return outcome;
  const candidates = await Promise.all(outcome.candidates.map(async candidate => {
    if (!isRecord(candidate) || !isRecord(candidate.jobDescription)
      || typeof candidate.jobDescription.id !== "string") return candidate;
    const result = await gigFinder.documentReader.get(candidate.jobDescription.id);
    return result.status === "ok" && result.record.storage === "managed"
      ? {
          ...candidate,
          jobDescription: {
            ...candidate.jobDescription,
            version: result.record.version,
          },
        }
      : candidate;
  }));
  return { ...outcome, candidates };
}

const scoutBackfillRequest = <T>(operation: () => T) => {
  try {
    return operation();
  } catch (reason) {
    throw new WebRequestError(
      reason instanceof Error
        ? reason.message
        : "Invalid Scout position backfill request.",
      400,
    );
  }
};

async function scoutBackfillBody(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    throw new WebRequestError("Request body must be valid JSON.", 400, {
      cause: error,
    });
  }
}

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
  scout?: ScoutRunService;
  scoutPositions?:ScoutPositionService;
  importScoutCompany?(value:unknown):{created:number;unchanged:number;versioned:number;rejected:number};
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

const managedDocumentReferencePattern = /^doc_[0-9a-f]+(?:-[0-9a-f]+)*$/i;

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
  if (!Number.isSafeInteger(version) || !managedDocumentReferencePattern.test(reference)) {
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

export function createWebHandler({gigFinder,agentApi,uploadHandler,discardStagedDocument,requestLogger,healthCheck,staticFiles,scout,scoutPositions,importScoutCompany}:WebHandlerDependencies) {
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
      } else if (url.pathname === "/api/gig-scout/companies") {
        if(request.method!=="POST")response=json({error:"Method not allowed"},405);else if(!importScoutCompany)response=json({error:"Gig Scout unavailable"},503);else{let body:unknown;try{body=await request.json();}catch{throw new WebRequestError("Request body must be valid JSON.",400);}const report=importScoutCompany(body);response=report.rejected?json(report,400):json(report,report.created||report.versioned?201:200);}
      } else if(url.pathname==="/api/gig-scout/settings/relevance"){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method==="GET")response=json(scoutPositions.relevance());else if(request.method==="PUT"){let body:unknown;try{body=await request.json();}catch{throw new WebRequestError("Request body must be valid JSON.",400);}if(!isRecord(body))throw new WebRequestError("Request body must be an object.",400);response=json(scoutPositions.configureRelevance({criteria:body.criteria,confidenceThreshold:body.confidenceThreshold}));}else response=json({error:"Method not allowed"},405);
      } else if(url.pathname==="/api/gig-scout/positions"){
        response=!scoutPositions?json({error:"Gig Scout unavailable"},503):request.method!=="GET"?json({error:"Method not allowed"},405):json(scoutPositions.list({text:url.searchParams.get("text")??undefined,company:url.searchParams.get("company")??undefined,state:url.searchParams.get("state")??undefined,sort:url.searchParams.get("sort")??undefined,direction:(url.searchParams.get("direction")??undefined) as "asc"|"desc"|undefined,offset:Number(url.searchParams.get("offset")??0),limit:Number(url.searchParams.get("limit")??20)}));
      } else if (url.pathname === "/api/gig-scout/positions/backfill/preview") {
        if (!scoutPositions) {
          response = json({ error: "Gig Scout unavailable" }, 503);
        } else if (request.method !== "POST") {
          response = json({ error: "Method not allowed" }, 405);
        } else if (url.searchParams.size) {
          throw new WebRequestError(
            "Explicit Scout position backfill does not accept query filters.",
            400,
          );
        } else {
          const body = await scoutBackfillBody(request);
          response = json(scoutBackfillRequest(
            () => scoutPositions.previewBackfill(body),
          ));
        }
      } else if (url.pathname === "/api/gig-scout/positions/backfill") {
        if (!scoutPositions) {
          response = json({ error: "Gig Scout unavailable" }, 503);
        } else if (request.method !== "POST") {
          response = json({ error: "Method not allowed" }, 405);
        } else if (url.searchParams.has("sourceRunId")) {
          response = json(scoutPositions.backfill(
            url.searchParams.get("sourceRunId") ?? "",
            Number(url.searchParams.get("limit") ?? 100),
          ), 202);
        } else if (url.searchParams.size) {
          throw new WebRequestError(
            "Explicit Scout position backfill does not accept query filters.",
            400,
          );
        } else {
          const body = await scoutBackfillBody(request);
          response = json(scoutBackfillRequest(
            () => scoutPositions.startBackfill(body),
          ), 202);
        }
      } else if (url.pathname.match(/^\/api\/gig-scout\/positions\/backfill\/[^/]+$/)) {
        if (!scoutPositions) {
          response = json({ error: "Gig Scout unavailable" }, 503);
        } else if (request.method !== "GET") {
          response = json({ error: "Method not allowed" }, 405);
        } else {
          const runId = decodeURIComponent(url.pathname.slice(
            "/api/gig-scout/positions/backfill/".length,
          ));
          const status = scoutBackfillRequest(
            () => scoutPositions.backfillStatus(runId),
          );
          response = status
            ? json(status)
            : json({ error: "Scout position backfill not found" }, 404);
        }
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+$/)){
        const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const position=scoutPositions?.get(positionId);response=request.method!=="GET"?json({error:"Method not allowed"},405):position?json(position):json({error:"Scout position not found"},404);
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+\/decision$/)){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method!=="POST")response=json({error:"Method not allowed"},405);else{const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const body=await scoutDecisionBody(request);const outcome=scoutMutation(()=>scoutPositions.decide(positionId,{...body,actor:trustedUserActor} as never));response=json(await scoutDecisionResponse(outcome,gigFinder));}
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+\/restore$/)){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method!=="POST")response=json({error:"Method not allowed"},405);else{const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const body=await request.json() as Record<string,unknown>;response=json(scoutMutation(()=>scoutPositions.restore(positionId,{...body,actor:trustedUserActor} as never)));}
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+\/reverse$/)){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method!=="POST")response=json({error:"Method not allowed"},405);else{const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const body=await request.json() as Record<string,unknown>;response=json(scoutMutation(()=>scoutPositions.reverse(positionId,{...body,actor:trustedUserActor} as never)));}
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+\/notes$/)){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method!=="POST")response=json({error:"Method not allowed"},405);else{const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const body=await request.json() as Record<string,unknown>;response=json(scoutMutation(()=>scoutPositions.addNote(positionId,{...body,actor:trustedUserActor} as never)),201);}
      } else if(url.pathname.match(/^\/api\/gig-scout\/positions\/[^/]+\/promotion\/retry$/)){
        if(!scoutPositions)response=json({error:"Gig Scout unavailable"},503);else if(request.method!=="POST")response=json({error:"Method not allowed"},405);else{const positionId=decodeURIComponent(url.pathname.split("/")[4]??"");const outcome=scoutMutation(()=>scoutPositions.retryPromotion(positionId));response=json(await scoutDecisionResponse(outcome,gigFinder),202);}
      } else if (url.pathname === "/api/gig-scout/runs") {
        if (!scout) {
          response = json({ error: "Gig Scout unavailable" }, 503);
        } else if (request.method === "GET") {
          response = json(scout.list());
        } else if (request.method === "POST") {
          let settings: unknown = {};
          try {
            const body = await request.text();
            if (body.trim()) settings = JSON.parse(body);
          } catch {
            throw new WebRequestError("Request body must be valid JSON.", 400);
          }
          response = json(
            scout.startFull(
              settings && typeof settings === "object"
                ? (settings as Parameters<typeof scout.startFull>[0])
                : {},
            ),
            202,
          );
        } else {
          response = json({ error: "Method not allowed" }, 405);
        }
      } else if (url.pathname.match(/^\/api\/gig-scout\/runs\/[^/]+\/positions$/)) {
        const id=decodeURIComponent(url.pathname.split("/")[4]??""); response=!scout?json({error:"Gig Scout unavailable"},503):request.method!=="GET"?json({error:"Method not allowed"},405):json(scout.positions(id,{company:url.searchParams.get("company")??undefined,text:url.searchParams.get("text")??undefined,offset:Number(url.searchParams.get("offset")??0),limit:Number(url.searchParams.get("limit")??20)}));
      } else if (url.pathname.match(/^\/api\/gig-scout\/runs\/[^/]+$/)) {
        const id=decodeURIComponent(url.pathname.split("/")[4]??""); const run=scout?.get(id);response=request.method!=="GET"?json({error:"Method not allowed"},405):run?json(run):json({error:"Scout run not found"},404);
      } else if (request.method !== "GET") {
        response = json({ error: "Read-only API" }, 405);
      } else if (url.pathname === "/api/gigs") {
        response = json(gigFinder.gigs.list());
      } else if (url.pathname === "/api/people") {
        response = json(gigFinder.people.list());
      } else if (url.pathname === "/api/tasks") {
        response = json(gigFinder.tasks.list());
      } else {
        response = await staticFiles?.(request) ?? json({ error: "Not found" }, 404);
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
