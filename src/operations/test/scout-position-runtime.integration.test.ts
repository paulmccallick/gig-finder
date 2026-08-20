import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  ScoutPositionProcessingJob,
  ScoutPositionStore,
} from "../../core/scout/engine/positions";
import { ScoutPositionRuntime } from "../scout-position-runtime";

const root = mkdtempSync(path.join("tmp/", "scout-position-runtime-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("position runtime retries a failed initial dispatch before consuming work", async () => {
  const job: ScoutPositionProcessingJob = {
    id: "synthetic-processing",
    positionId: "synthetic-position",
    stage: "reconcile_gig",
    inputIdentity: "synthetic-input",
    attemptCount: 0,
  };
  let backfillCalls = 0;
  let reconciled = false;
  const store: ScoutPositionStore = {
    backfillPositions() {
      backfillCalls++;
      if (backfillCalls === 1) throw new Error("synthetic dispatch failure");
      return { created: 0, complete: true };
    },
    pendingPositionJobs() {
      return reconciled ? [] : [job];
    },
    markPositionJobsDispatched() {},
    reconcileGig(value) {
      expect(value).toEqual(job);
      reconciled = true;
    },
    failPositionProcessing() {
      throw new Error("position processing should not exhaust retries");
    },
    workspace() {
      throw new Error("not used");
    },
    positionDetail() {
      throw new Error("not used");
    },
  };
  const runtime = new ScoutPositionRuntime(store, {
    dataPath: path.join(root, "queue.sqlite"),
    batchSize: 1,
    concurrency: 1,
  });
  try {
    runtime.start();
    const deadline = Date.now() + 5_000;
    while (!reconciled && Date.now() < deadline) await Bun.sleep(25);
    expect(backfillCalls).toBeGreaterThanOrEqual(2);
    expect(reconciled).toBeTrue();
  } finally {
    await runtime.close();
  }
}, 10_000);
