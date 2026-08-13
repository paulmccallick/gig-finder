import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { Queue, Worker, type Job } from "bunqueue/client";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import { migrateDatabase, openDatabase } from "../../data/database";
import { SqliteScoutCompanyImportStore } from "../../data/scout-company-import-store";
import { SqliteScoutRunStore } from "../../data/scout-run-store";
import type { GigScoutHttpPort } from "../../core/scout/engine";
import { ScoutRuntime } from "../scout-runtime";

const root = mkdtempSync(path.join("tmp/", "scout-runtime-"));
const queueDataPath = path.join(root, "queue.sqlite");
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("real embedded queue heartbeats beyond its configured ownership boundary", async () => {
  const database = openDatabase(path.join(root, "app.sqlite"));
  migrateDatabase(database);
  importScoutCompany(
    {
      id: "company-1",
      name: "Synthetic Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/jobs",
          active: true,
          method: "GET",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(database),
  );
  const store = new SqliteScoutRunStore(database),
    run = store.startOrReuse(20, 1, new Date().toISOString()).run;
  let calls = 0,
    stalls = 0;
  const loggedEvents: string[] = [];
  const http: GigScoutHttpPort = {
    async request(input) {
      calls++;
      await Bun.sleep(11_000);
      return {
        status: 200,
        url: input.url,
        headers: {},
        body: JSON.stringify({
          jobs: [
            {
              id: "role-1",
              title: "Reliability Gardener",
              url: "https://careers.example.test/jobs/role-1",
            },
          ],
        }),
      };
    },
  };
  const runtime = new ScoutRuntime(store, {
    dataPath: queueDataPath,
    batchSize: 20,
    concurrency: 1,
    http,
    heartbeatInterval: 25,
    stallInterval: 300,
    stallGracePeriod: 0,
    onWorkerStalled: () => stalls++,
    logger: {
      info(fields) {
        loggedEvents.push(String(fields.event));
      },
      error(fields) {
        loggedEvents.push(String(fields.event));
      },
    },
  });
  try {
    runtime.start();
    const deadline = Date.now() + 15_000;
    while (
      ["queued", "running"].includes(store.get(run.id)?.status ?? "") &&
      Date.now() < deadline
    )
      await Bun.sleep(25);
    expect(store.get(run.id)).toMatchObject({
      status: "completed",
      succeededCount: 1,
      failedCount: 0,
    });
    expect(
      store.positions(run.id, { offset: 0, limit: 20 }).items,
    ).toHaveLength(1);
    expect(calls).toBe(1);
    expect(stalls).toBe(0);
  } finally {
    await runtime.close();
    expect(loggedEvents).toEqual(
      expect.arrayContaining([
        "scout.queue.initializing",
        "scout.queue.startup_reconciliation_started",
        "scout.queue.startup_reconciliation_completed",
        "scout.queue.dispatch_started",
        "scout.queue.dispatch_completed",
        "scout.queue.job_claimed",
        "scout.queue.job_handling",
        "scout.http.request_started",
        "scout.http.request_completed",
        "scout.queue.job_acknowledged",
        "scout.queue.job_completed",
        "scout.queue.shutdown_started",
        "scout.queue.shutdown_completed",
      ]),
    );
    database.close();
  }
}, 20_000);

test("real embedded queue stalls the same long job when heartbeats are disabled", async () => {
  const queue = new Queue<{ marker: string }>("heartbeat-control", {
    embedded: true,
    dataPath: queueDataPath,
  });
  queue.setStallConfig({
    enabled: true,
    stallInterval: 300,
    gracePeriod: 0,
    maxStalls: 1,
  });
  let stalls = 0;
  const worker = new Worker(
    "heartbeat-control",
    async (_job: Job<{ marker: string }>) => {
      await Bun.sleep(11_000);
      return "finished-too-late";
    },
    {
      embedded: true,
      dataPath: queueDataPath,
      useLocks: false,
      heartbeatInterval: 0,
      autorun: false,
    },
  );
  worker.on("stalled", () => stalls++);

  try {
    await queue.add("control", { marker: "no-heartbeat" });
    worker.run();
    const deadline = Date.now() + 13_000;
    while (stalls === 0 && Date.now() < deadline) await Bun.sleep(25);
    expect(stalls).toBeGreaterThan(0);
  } finally {
    await worker.close();
    await queue.close();
  }
}, 18_000);
