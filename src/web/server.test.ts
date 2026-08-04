import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import pino from "pino";
import { GigFinderApplication } from "../core/src/application";
import type { ArtifactPort } from "../core/src/ports";
import {
  AuditReader,
  DataStore,
  migrateDatabase,
  openDatabase,
} from "../data/src";
import { createWebHandler } from "./server";

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

beforeEach(() => {
  database = openDatabase(":memory:");
  migrateDatabase(database);
  const application = new GigFinderApplication(
    new DataStore(database),
    new AuditReader(database),
    artifacts,
  );
  fetchRequest = createWebHandler({
    gigFinder: application,
    agentHandler: async () => new Response(null),
    uploadHandler: async () => new Response(null),
    discardStagedDocument: () => false,
    requestLogger: () => logger,
  });
});

afterEach(() => database.close());

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

describe("production health", () => {
  test("reports revision and database readiness", async () => {
    const application = new GigFinderApplication(
      new DataStore(database),
      new AuditReader(database),
      artifacts,
    );
    const handler = createWebHandler({
      gigFinder: application,
      agentHandler: async () => new Response(null),
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
