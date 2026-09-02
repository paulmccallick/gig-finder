import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import pino from "pino";
import { GigFinderApplication } from "../../core/application";
import {
  AuditReader,
  DataStore,
  migrateDatabase,
  openDatabase,
  SqliteScoutCompanyImportStore,
} from "../../data";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import { ScoutPositionService } from "../../core/scout/engine/scout-position-service";
import { createWebHandler } from "../request-handler";

const logger = pino({ enabled: false });
const requestServer = { timeout: () => undefined };

let database: Database;
let fetchRequest: ReturnType<typeof createWebHandler>;
let application: GigFinderApplication;

beforeEach(() => {
  database = openDatabase(":memory:");
  migrateDatabase(database);
  application = new GigFinderApplication(
    new DataStore(database),
    new AuditReader(database),
  );
  fetchRequest = createWebHandler({
    gigFinder: application,
    agentApi: {
      messages: async () => new Response(null),
      list: () => Response.json({ conversations: [] }),
      load: () => Response.json({ error: "Not found" }, { status: 404 }),
    },
    uploadHandler: async () => new Response(null),
    discardStagedDocument: () => false,
    requestLogger: () => logger,
    importScoutCompany:value=>importScoutCompany(value,new SqliteScoutCompanyImportStore(database)),
  });
});

afterEach(() => database.close());

describe("Gig Scout company API",()=>{
  test("creates one private company idempotently without returning its configuration",async()=>{const body={id:"company-1",name:"Example Company",active:true,sources:[{key:"official",type:"json",url:"https://careers.example.test/jobs",recordsPath:"jobs",fields:{title:"title",url:"url"}}]};const first=await fetchRequest(new Request("http://localhost/api/gig-scout/companies",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),requestServer);expect(first.status).toBe(201);expect(await first.json()).toEqual({created:1,unchanged:0,versioned:0,rejected:0});const second=await fetchRequest(new Request("http://localhost/api/gig-scout/companies",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),requestServer);expect(second.status).toBe(200);expect(await second.json()).toEqual({created:0,unchanged:1,versioned:0,rejected:0});});
});

describe("Gig Scout position mutation API",()=>{
  const reviewedDecision = {
    changeId: "accepted",
    action: "pursue",
    note: "Optional review context",
    expectedStateRevision: 2,
    descriptionId: "spdesc_synthetic",
    relevanceEvaluationId: "srel_synthetic",
    candidateMatchEvaluationId: "smatch_synthetic",
    resolution: {
      kind: "use_existing",
      reviewedFingerprint: "a".repeat(64),
      gigId: "gig-synthetic",
      expectedGigRevision: 3,
    },
  };

  function decisionHandler(decide: (input: Record<string, unknown>) => unknown) {
    const calls:Array<Record<string,unknown>>=[];
    const scoutPositions={
      decide(_positionId:string,input:Record<string,unknown>){calls.push(input);return decide(input);},
    };
    const handler=createWebHandler({gigFinder:application,agentApi:{messages:async()=>new Response(null),list:()=>Response.json({conversations:[]}),load:()=>Response.json({error:"Not found"},{status:404})},uploadHandler:async()=>new Response(null),discardStagedDocument:()=>false,requestLogger:()=>logger,scoutPositions:scoutPositions as never});
    const request=(body:string)=>handler(new Request("http://localhost/api/gig-scout/positions/position-1/decision",{method:"POST",headers:{"content-type":"application/json"},body}),requestServer);
    return { calls, request };
  }

  test("accepts only reviewed decision and resolution fields and injects the trusted actor",async()=>{
    const { calls, request } = decisionHandler(() => ({ status: "updated" }));
    const accepted = await request(JSON.stringify(reviewedDecision));
    expect(accepted.status).toBe(200);
    expect(calls).toEqual([{ ...reviewedDecision, actor: "User" }]);

    const callerActor = await request(JSON.stringify({
      ...reviewedDecision,
      actor: "Forged caller",
    }));
    expect(callerActor.status).toBe(422);
    expect(await callerActor.json()).toEqual({
      error: "Scout position decision accepts only reviewed decision and resolution fields.",
    });

    const rejected = await request(JSON.stringify({
      ...reviewedDecision,
      gig: { stage: "applied" },
    }));
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toEqual({
      error: "Scout position decision accepts only reviewed decision and resolution fields.",
    });
    expect(calls).toHaveLength(1);
  });

  test("returns every stable posting identity outcome with HTTP 200", async () => {
    const outcomes = [
      { status: "created" },
      { status: "updated" },
      { status: "resolution_required", fingerprint: "b".repeat(64), candidates: [] },
      { status: "resolution_stale", fingerprint: "c".repeat(64), candidates: [] },
      { status: "resolution_invalid" },
    ];
    let index = 0;
    const { request } = decisionHandler(() => outcomes[index++]);
    for (const outcome of outcomes) {
      const response = await request(JSON.stringify(reviewedDecision));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(outcome);
    }
  });

  test("binds each candidate document link to its current reviewed version", async () => {
    const documentId = createVersionedDocument();
    const { request } = decisionHandler(() => ({
      status: "resolution_required",
      fingerprint: "d".repeat(64),
      candidates: [{
        gigId: "gig-document",
        revision: 1,
        company: "Example Company",
        title: "Director",
        externalJobId: null,
        sourceUrl: null,
        location: null,
        stage: "identified",
        outcome: "pending",
        availability: "unknown",
        lastActivity: "2026-08-08",
        jobDescription: {
          id: documentId,
          type: "job_description",
          title: "Role Brief",
          displayName: "Role Brief",
        },
        matchReasons: ["company_title"],
      }],
    }));
    const response = await request(JSON.stringify(reviewedDecision));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidates: [{ jobDescription: { id: documentId, version: 2 } }],
    });
  });

  test("retry enriches stale candidate documents through the decision response path", async () => {
    const documentId = createVersionedDocument();
    const position = { id: "position-1", state: "needs_user_review", stateRevision: 4 };
    const scoutPositions = {
      retryPromotion() {
        return {
          status: "resolution_stale",
          fingerprint: "e".repeat(64),
          position,
          candidates: [{
            gigId: "gig-document",
            revision: 2,
            company: "Example Company",
            title: "Director",
            externalJobId: "REQ-2",
            sourceUrl: "https://careers.example.test/jobs/REQ-2",
            location: "Remote",
            stage: "identified",
            outcome: "pending",
            availability: "unknown",
            lastActivity: "2026-09-01",
            jobDescription: {
              id: documentId,
              type: "job_description",
              title: "Role Brief",
              displayName: "Role Brief",
            },
            matchReasons: ["company_requisition"],
          }],
        };
      },
    };
    const handler = createWebHandler({
      gigFinder: application,
      agentApi: { messages: async () => new Response(null), list: () => Response.json({ conversations: [] }), load: () => Response.json({ error: "Not found" }, { status: 404 }) },
      uploadHandler: async () => new Response(null),
      discardStagedDocument: () => false,
      requestLogger: () => logger,
      scoutPositions: scoutPositions as never,
    });
    const response = await handler(new Request("http://localhost/api/gig-scout/positions/position-1/promotion/retry", { method: "POST" }), requestServer);

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      status: "resolution_stale",
      position,
      candidates: [{ jobDescription: { id: documentId, version: 2 } }],
    });
  });

  test("retains 409 for revised review evidence and returns 422 for malformed commands",async()=>{
    const calls:Array<Record<string,unknown>>=[];
    const scoutPositions={
      decide(_positionId:string,input:Record<string,unknown>){calls.push(input);if(input.changeId==="stale")throw new Error("This position was revised and requires review again.");if(input.changeId==="invalid")throw new Error("Decision note must contain 1 to 2000 characters.");return{ok:true};},
    };
    const handler=createWebHandler({gigFinder:application,agentApi:{messages:async()=>new Response(null),list:()=>Response.json({conversations:[]}),load:()=>Response.json({error:"Not found"},{status:404})},uploadHandler:async()=>new Response(null),discardStagedDocument:()=>false,requestLogger:()=>logger,scoutPositions:scoutPositions as never});
    const decide=(changeId:string)=>handler(new Request("http://localhost/api/gig-scout/positions/position-1/decision",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({changeId})}),requestServer);
    expect((await decide("accepted")).status).toBe(200);
    expect(calls[0]).toMatchObject({changeId:"accepted",actor:"User"});
    const stale=await decide("stale");expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({error:"This position was revised and requires review again."});
    const invalid=await decide("invalid");expect(invalid.status).toBe(422);expect(await invalid.json()).toMatchObject({error:"Decision note must contain 1 to 2000 characters."});
    const malformed = await handler(new Request("http://localhost/api/gig-scout/positions/position-1/decision",{method:"POST",headers:{"content-type":"application/json"},body:"{"}),requestServer);
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toEqual({ error: "Request body must be valid JSON." });
  });
});

describe("explicit position backfill API", () => {
  const firstPositionId = `spos_${"1".repeat(32)}`;
  const secondPositionId = `spos_${"2".repeat(32)}`;
  const reason = "Reprocess entity-encoded descriptions after converter v2";

  function backfillHandler(options: { rejected?: boolean } = {}) {
    const calls: {
      preview: Array<Record<string, unknown>>;
      start: Array<Record<string, unknown>>;
      status: string[];
      legacy: Array<{ sourceRunId: string; limit: number }>;
    } = {
      preview: [],
      start: [],
      status: [],
      legacy: [],
    };
    const status = {
      runId: "srun_12345678-1234-1234-8234-123456789abc",
      reason,
      status: "running" as const,
      completedAt: null,
      selection: { requested: 1, accepted: 1, rejected: 0 },
      stages: {
        reconcile_gig: { pending: 1, completed: 0, failed: 0, superseded: 0 },
        acquire_description: { pending: 0, completed: 0, failed: 0, superseded: 0 },
        screen_relevance: { pending: 0, completed: 0, failed: 0, superseded: 0 },
        score_candidate_match: { pending: 0, completed: 0, failed: 0, superseded: 0 },
      },
      positionOutcomes: { pending: 1 },
      positions: [{
        positionId: firstPositionId,
        company: "Example Company",
        template: "custom",
        descriptionOutcome: null,
        outcome: "pending",
        failureCode: null,
      }],
      gigDocuments: { pending: 0, updated: 0, unchanged: 0, failed: 0 },
    };
    const scoutStore = {
      previewBackfill(input: Record<string, unknown>) {
        calls.preview.push(input);
        return options.rejected
          ? {
              requested: 1,
              accepted: [],
              rejected: [{ positionId: firstPositionId, code: "not_found" }],
            }
          : {
              requested: 1,
              accepted: [{
                positionId: firstPositionId,
                company: "Example Company",
                title: "Director",
                state: "needs_user_review",
                linkedGigId: null,
              }],
              rejected: [],
            };
      },
      startBackfill(input: Record<string, unknown>) {
        calls.start.push(input);
        if (options.rejected) {
          throw new Error(
            `Scout position backfill rejected ${firstPositionId} (not_found).`,
          );
        }
        return status;
      },
      backfillStatus(runId: string) {
        calls.status.push(runId);
        return runId === status.runId ? status : null;
      },
      backfillPositions(sourceRunId: string, limit: number) {
        calls.legacy.push({ sourceRunId, limit });
        return { legacy: true };
      },
    };
    const scoutPositions = new ScoutPositionService(
      scoutStore as never,
      {} as never,
      {} as never,
    );
    const handler = createWebHandler({
      gigFinder: application,
      agentApi: {
        messages: async () => new Response(null),
        list: () => Response.json({ conversations: [] }),
        load: () => Response.json({ error: "Not found" }, { status: 404 }),
      },
      uploadHandler: async () => new Response(null),
      discardStagedDocument: () => false,
      requestLogger: () => logger,
      scoutPositions: scoutPositions as never,
    });
    const post = (requestPath: string, body: unknown) => handler(
      new Request(`http://localhost${requestPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      requestServer,
    );
    const get = (requestPath: string) => handler(
      new Request(`http://localhost${requestPath}`),
      requestServer,
    );
    return { calls, status, post, get };
  }

  test("explicit position backfill previews without starting and normalizes duplicate IDs", async () => {
    const api = backfillHandler();
    const response = await api.post(
      "/api/gig-scout/positions/backfill/preview",
      {
        positionIds: [secondPositionId, firstPositionId, secondPositionId],
        reason: ` ${reason} `,
      },
    );
    expect(response.status).toBe(200);
    expect(api.calls.preview).toEqual([{
      positionIds: [firstPositionId, secondPositionId],
      reason,
    }]);
    expect(api.calls.start).toEqual([]);
  });

  test("explicit position backfill applies its limit after duplicate IDs normalize", async () => {
    const api = backfillHandler();
    const response = await api.post(
      "/api/gig-scout/positions/backfill/preview",
      {
        positionIds: Array.from({ length: 1001 }, () => firstPositionId),
        reason,
      },
    );

    expect(response.status).toBe(200);
    expect(api.calls.preview).toEqual([{
      positionIds: [firstPositionId],
      reason,
    }]);
  });

  test("explicit position backfill starts durable work and returns stable status", async () => {
    const api = backfillHandler();
    const started = await api.post("/api/gig-scout/positions/backfill", {
      positionIds: [firstPositionId],
      reason,
    });
    expect(started.status).toBe(202);
    expect(await started.json()).toEqual(api.status);
    expect(api.calls.start).toEqual([{
      positionIds: [firstPositionId],
      reason,
    }]);

    const status = await api.get(
      `/api/gig-scout/positions/backfill/${api.status.runId}`,
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(api.status);
    expect(api.calls.status).toEqual([api.status.runId]);
  });

  test("explicit position backfill rejects malformed, empty, oversized, and implicit selections", async () => {
    const api = backfillHandler();
    const invalidBodies: unknown[] = [
      { positionIds: [], reason },
      { positionIds: ["position-1"], reason },
      {
        positionIds: Array.from(
          { length: 1001 },
          (_, index) => `spos_${index.toString(16).padStart(32, "0")}`,
        ),
        reason,
      },
      { positionIds: [firstPositionId], reason: "" },
      { positionIds: [firstPositionId], reason: "x".repeat(501) },
      {
        positionIds: [firstPositionId],
        reason,
        states: ["needs_user_review"],
      },
      { positionIds: [firstPositionId], reason, company: "Example Company" },
      {
        positionIds: [firstPositionId],
        reason,
        where: "state = 'needs_user_review'",
      },
    ];
    for (const body of invalidBodies) {
      const response = await api.post("/api/gig-scout/positions/backfill", body);
      expect(response.status).toBe(400);
    }
    expect(api.calls.start).toEqual([]);
  });

  test("explicit position backfill prevents partial start when an exact ID is rejected", async () => {
    const api = backfillHandler({ rejected: true });
    const preview = await api.post(
      "/api/gig-scout/positions/backfill/preview",
      { positionIds: [firstPositionId], reason },
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      accepted: [],
      rejected: [{ positionId: firstPositionId, code: "not_found" }],
    });
    const start = await api.post("/api/gig-scout/positions/backfill", {
      positionIds: [firstPositionId],
      reason,
    });
    expect(start.status).toBe(400);
    expect(api.calls.start).toHaveLength(1);
  });

  test("explicit position backfill preserves the source-run query form", async () => {
    const api = backfillHandler();
    const response = await api.post(
      "/api/gig-scout/positions/backfill?sourceRunId=srun_source&limit=25",
      {},
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ legacy: true });
    expect(api.calls.legacy).toEqual([{ sourceRunId: "srun_source", limit: 25 }]);
    expect(api.calls.start).toEqual([]);
  });
});

function createVersionedDocument() {
  application.gigs.create({ actor: "test", source: "test", summary: "Create synthetic gig" }, {
    id: "gig-document", company: "Example Company", title: "Director",
    externalJobId: null, stage: "identified",
    outcome: "pending", statusSummary: "Identified", lastActivity: "2026-08-08",
    nextAction: null, fit: { rating: "good", summary: null }, payRange: null,
    sourceUrl: null, tags: [],
  });
  const created = application.documents.create({
    actor: "test", source: "test", summary: "Create synthetic document",
    changeId: "document-create",
  }, {
    links: [{ entityType: "gig", entityId: "gig-document" }],
    documentType: "job_description",
    title: "../../Role Brief",
    mediaType: "text/markdown",
    sourceDescription: "Synthetic fixture",
    content: "# Original\n\nFirst version.",
  });
  application.documents.update({
    actor: "test", source: "test", summary: "Update synthetic document",
    changeId: "document-update",
  }, {
    documentId: created.document.id,
    expectedVersion: 1,
    content: "# Current\n\nSecond version.",
    changeSummary: "Update fixture",
  });
  return created.document.id;
}

describe("agent model settings API", () => {
  test("returns the default and persists a supported selection", async () => {
    const initial = await fetchRequest(
      new Request("http://localhost/api/settings/agent-model"),
      requestServer,
    );
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ agentModel: "gpt-5.6-sol" });

    const update = await fetchRequest(
      new Request("http://localhost/api/settings/agent-model", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: "gpt-5.6-luna" }),
      }),
      requestServer,
    );
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ agentModel: "gpt-5.6-luna" });

    const persisted = await fetchRequest(
      new Request("http://localhost/api/settings/agent-model"),
      requestServer,
    );
    expect(await persisted.json()).toEqual({ agentModel: "gpt-5.6-luna" });
  });

  test("rejects unsupported values without changing the preference", async () => {
    const invalid = await fetchRequest(
      new Request("http://localhost/api/settings/agent-model", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId: "gpt-unsupported" }),
      }),
      requestServer,
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({
      error: "Agent model must be one of: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna.",
      code: "domain_validation_failed",
    });

    const persisted = await fetchRequest(
      new Request("http://localhost/api/settings/agent-model"),
      requestServer,
    );
    expect(await persisted.json()).toEqual({ agentModel: "gpt-5.6-sol" });
  });
});

describe("application health", () => {
  test("reports revision and database readiness", async () => {
    const application = new GigFinderApplication(
      new DataStore(database),
      new AuditReader(database),
    );
    const handler = createWebHandler({
      gigFinder: application,
      agentApi: {
        messages: async () => new Response(null),
        list: () => Response.json({ conversations: [] }),
        load: () => Response.json({ error: "Not found" }, { status: 404 }),
      },
      uploadHandler: async () => new Response(null),
      discardStagedDocument: () => false,
      requestLogger: () => logger,
      healthCheck: () => ({
        ok: true,
        revision: "a".repeat(40),
        integrity: "ok",
        foreignKeyViolations: 0,
      }),
    });

    const response = await handler(
      new Request("http://localhost/healthz"),
      requestServer,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      revision: "a".repeat(40),
      database: { integrity: "ok", foreignKeyViolations: 0 },
    });
  });
});

describe("managed document version API", () => {
  test("reads and downloads the exact authoritative version", async () => {
    const documentId = createVersionedDocument();
    const encoded = encodeURIComponent(documentId);
    const read = await fetchRequest(
      new Request(`http://localhost/api/documents/${encoded}/versions/1`),
      requestServer,
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(await read.json()).toEqual({
      reference: documentId,
      storage: "managed",
      displayName: "../../Role Brief",
      documentType: "job_description",
      mediaType: "text/markdown",
      version: 1,
      currentVersion: 2,
      content: "# Original\n\nFirst version.",
    });

    const download = await fetchRequest(
      new Request(`http://localhost/api/documents/${encoded}/versions/1/download`),
      requestServer,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(download.headers.get("cache-control")).toBe("no-store");
    expect(download.headers.get("content-disposition"))
      .toBe('attachment; filename="Role Brief.md"');
    expect(await download.text()).toBe("# Original\n\nFirst version.");
    expect(download.headers.get("content-disposition")).not.toContain(documentId);
  });

  test("rejects malformed, non-managed, missing, and path-like references", async () => {
    const documentId = createVersionedDocument();
    const malformedPaths = [
      "/api/documents/not-a-document/versions/1",
      "/api/documents/doc_----/versions/1",
      "/api/documents/doc_a-/versions/1",
      "/api/documents/doc_a--b/versions/1",
      `/api/documents/${encodeURIComponent(documentId)}/versions/0`,
      "/api/documents/gig%3Agig-document%3Ajob_description/versions/1",
      "/api/documents/..%2Fsecrets/versions/1",
      `/api/documents/${encodeURIComponent(documentId)}/versions/1/extra`,
    ];
    for (const path of malformedPaths) {
      const response = await fetchRequest(new Request(`http://localhost${path}`), requestServer);
      expect(response.status).toBe(400);
    }
    const missing = await fetchRequest(new Request(
      `http://localhost/api/documents/${encodeURIComponent(documentId)}/versions/99`,
    ), requestServer);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Document version not found" });
  });
});
