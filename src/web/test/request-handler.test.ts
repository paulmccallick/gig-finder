import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import pino from "pino";
import { GigFinderApplication } from "../../core/application";
import type { ArtifactPort } from "../../core/ports";
import {
  AuditReader,
  DataStore,
  migrateDatabase,
  openDatabase,
  SqliteScoutCompanyImportStore,
} from "../../data";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import { createWebHandler } from "../request-handler";

const artifacts: ArtifactPort = {
  jobDescription: async () => "",
  interviewPrep: async () => [],
  jobDescriptionExists: async () => false,
  interviewPrepExists: async () => false,
  verify: async () => ({ ok: true, errors: [], unregistered: [] }),
};
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
    artifacts,
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

function createVersionedDocument() {
  application.gigs.create({ actor: "test", source: "test", summary: "Create synthetic gig" }, {
    id: "gig-document", company: "Example Company", title: "Director",
    externalJobId: null, artifactDirectory: null, stage: "identified",
    outcome: "pending", statusSummary: "Identified", lastActivity: "2026-08-08",
    nextAction: null, fit: { rating: "good", summary: null }, payRange: null,
    sourceUrl: null, tags: [], hasJobDescription: false, hasInterviewPrep: false,
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
      artifacts,
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
