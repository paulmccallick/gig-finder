import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { Queue, Worker, type Job } from "bunqueue/client";
import { importScoutCompany } from "../../core/scout/engine/company-import";
import { migrateDatabase, openDatabase } from "../../data/database";
import { SqliteScoutCompanyImportStore } from "../../data/scout-company-import-store";
import { SqliteScoutRunStore } from "../../data/scout-run-store";
import type { GigScoutHttpPort } from "../../core/scout/engine";
import type { ScoutCompanyJob } from "../../core/scout/engine/runs";
import { ScoutRuntime } from "../scout-runtime";
import {ScoutPositionRuntime} from "../scout-position-runtime";
import type {ScoutPositionProcessingJob,ScoutPositionStore} from "../../core/scout/engine/positions";

mkdirSync("tmp",{recursive:true});
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

test("restart reconciliation reuses a durably dispatched embedded job", async () => {
  const database = openDatabase(path.join(root, "recovery-app.sqlite"));
  migrateDatabase(database);
  importScoutCompany(
    {
      id: "recovery-company",
      name: "Recovery Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/recovery",
          active: true,
          method: "GET",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(database),
  );
  const store = new SqliteScoutRunStore(database);
  const run = store.startOrReuse(20, 1, new Date().toISOString()).run;
  const recoveryQueuePath = path.join(root, "recovery-queue.sqlite");
  const dispatcher = new ScoutRuntime(store, {
    dataPath: recoveryQueuePath,
    batchSize: 20,
    concurrency: 1,
  });
  await dispatcher.dispatch();
  await dispatcher.close();

  let calls = 0;
  const runtime = new ScoutRuntime(store, {
    dataPath: recoveryQueuePath,
    batchSize: 20,
    concurrency: 1,
    http: {
      async request(input) {
        calls++;
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: JSON.stringify({
            jobs: [
              {
                id: "recovered-role",
                title: "Recovery Gardener",
                url: "https://careers.example.test/recovery/role",
              },
            ],
          }),
        };
      },
    },
  });
  try {
    runtime.start();
    const deadline = Date.now() + 5_000;
    while (
      ["queued", "running"].includes(store.get(run.id)?.status ?? "") &&
      Date.now() < deadline
    )
      await Bun.sleep(25);
    expect(store.get(run.id)).toMatchObject({
      status: "completed",
      succeededCount: 1,
    });
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    database.close();
  }
});

test("restart reconciliation rebuilds missing queue state from authoritative work", async () => {
  const database = openDatabase(path.join(root, "rebuild-app.sqlite"));
  migrateDatabase(database);
  importScoutCompany(
    {
      id: "rebuild-company",
      name: "Rebuild Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/rebuild",
          active: true,
          method: "GET",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(database),
  );
  const store = new SqliteScoutRunStore(database);
  const run = store.startOrReuse(20, 1, new Date().toISOString()).run;
  const dispatcher = new ScoutRuntime(store, {
    dataPath: path.join(root, "discarded-queue.sqlite"),
    batchSize: 20,
    concurrency: 1,
  });
  await dispatcher.dispatch();
  await dispatcher.close();

  let calls = 0;
  const runtime = new ScoutRuntime(store, {
    dataPath: path.join(root, "replacement-queue.sqlite"),
    batchSize: 20,
    concurrency: 1,
    http: {
      async request(input) {
        calls++;
        return {
          status: 200,
          url: input.url,
          headers: {},
          body: JSON.stringify({
            jobs: [
              {
                id: "rebuilt-role",
                title: "Rebuild Gardener",
                url: "https://careers.example.test/rebuild/role",
              },
            ],
          }),
        };
      },
    },
  });
  try {
    runtime.start();
    const deadline = Date.now() + 5_000;
    while (
      ["queued", "running"].includes(store.get(run.id)?.status ?? "") &&
      Date.now() < deadline
    )
      await Bun.sleep(25);
    expect(store.get(run.id)).toMatchObject({
      status: "completed",
      succeededCount: 1,
    });
    expect(calls).toBe(1);
  } finally {
    await runtime.close();
    database.close();
  }
});

test("restart reconciliation projects an exhausted queue job terminally", async () => {
  const database = openDatabase(path.join(root, "exhausted-app.sqlite"));
  migrateDatabase(database);
  importScoutCompany(
    {
      id: "exhausted-company",
      name: "Exhausted Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/exhausted",
          active: true,
          method: "GET",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(database),
  );
  const store = new SqliteScoutRunStore(database);
  const run = store.startOrReuse(20, 1, new Date().toISOString()).run;
  const job = store.nonterminalJobs(1)[0]!;
  const exhaustedQueuePath = path.join(root, "exhausted-queue.sqlite");
  const queue = new Queue<ScoutCompanyJob>("gig-scout-companies", {
    embedded: true,
    dataPath: exhaustedQueuePath,
  });
  const worker = new Worker<ScoutCompanyJob>(
    "gig-scout-companies",
    async () => {
      throw new Error("synthetic_exhaustion");
    },
    { embedded: true, dataPath: exhaustedQueuePath },
  );
  await queue.add("scan-company", job, {
    jobId: `scout:${job.runCompanyId}`,
    attempts: 1,
    durable: true,
  });
  const deadline = Date.now() + 5_000;
  while (
    (await queue.getJobState(`scout:${job.runCompanyId}`)) !== "failed" &&
    Date.now() < deadline
  )
    await Bun.sleep(25);
  await worker.close();
  await queue.close();

  const runtime = new ScoutRuntime(store, {
    dataPath: exhaustedQueuePath,
    batchSize: 20,
    concurrency: 1,
  });
  try {
    await runtime.dispatch();
    expect(store.get(run.id)).toMatchObject({
      status: "failed",
      failedCount: 1,
    });
  } finally {
    await runtime.close();
    database.close();
  }
});

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

test("position runtime retries a failed initial dispatch before consuming work",async()=>{
 const job:ScoutPositionProcessingJob={id:"synthetic-processing",positionId:"synthetic-position",stage:"reconcile_gig",inputIdentity:"synthetic-input",attemptCount:0};let pendingCalls=0,reconciled=false;
 const store:ScoutPositionStore={backfillPositions(){throw new Error("historical backfill must be explicitly requested");},pendingPositionJobs(){pendingCalls++;if(pendingCalls===1)throw new Error("synthetic dispatch failure");return reconciled?[]:[job];},markPositionJobsDispatched(){},reconcileGig(value){expect(value).toEqual(job);reconciled=true;},failPositionProcessing(){throw new Error("position processing should not exhaust retries");},workspace(){throw new Error("not used");},positionDetail(){throw new Error("not used");},decide(){throw new Error("not used");},restoreAgentIrrelevant(){throw new Error("not used");},reverseDecision(){throw new Error("not used");},appendPositionNote(){},retryPromotion(){throw new Error("not used");},resurfaceDue(){return 0;},relevanceCriteria(){throw new Error("not used");},appendRelevanceCriteria(){throw new Error("not used");}};
 const processor={async process(processingId:string){expect(processingId).toBe(job.id);reconciled=true;}} as import("../../core/scout/engine/screening").ScoutPositionProcessor;
 const runtime=new ScoutPositionRuntime(store,processor,{dataPath:path.join(root,"position-queue.sqlite"),batchSize:1,concurrency:1});
 try{runtime.start();const deadline=Date.now()+5_000;while(!reconciled&&Date.now()<deadline)await Bun.sleep(25);expect(pendingCalls).toBeGreaterThanOrEqual(2);expect(reconciled).toBeTrue();}finally{await runtime.close();}
},10_000);
