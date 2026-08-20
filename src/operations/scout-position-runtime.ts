import { Queue, Worker, type Job } from "bunqueue/client";
import type {
  ScoutPositionProcessingJob,
  ScoutPositionStore,
} from "../core/scout/engine/positions";

export class ScoutPositionRuntime {
  private readonly queue: Queue<ScoutPositionProcessingJob>;
  private readonly worker: Worker<ScoutPositionProcessingJob, { status: string }>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly store: ScoutPositionStore,
    options: { dataPath: string; batchSize: number; concurrency: number },
  ) {
    this.queue = new Queue("gig-scout-positions", {
      embedded: true,
      dataPath: options.dataPath,
      defaultJobOptions: { attempts: 3, backoff: 1000, durable: true },
    });
    this.worker = new Worker(
      "gig-scout-positions",
      async (job: Job<ScoutPositionProcessingJob>) => {
        try {
          this.store.reconcileGig(job.data, new Date().toISOString());
          return { status: "completed" };
        } catch (error) {
          if (job.attemptsMade + 1 >= 3) {
            this.store.failPositionProcessing(
              job.data,
              "worker_retry_exhausted",
              error instanceof Error ? error.message : "Position processing failed.",
              new Date().toISOString(),
            );
          }
          throw error;
        }
      },
      {
        embedded: true,
        dataPath: options.dataPath,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        useLocks: false,
        autorun: false,
      },
    );
  }

  async dispatch() {
    await this.queue.waitUntilReady();
    this.store.backfillPositions(100, new Date().toISOString());
    const jobs = this.store.pendingPositionJobs(1_000);
    const missing: ScoutPositionProcessingJob[] = [];
    for (const job of jobs) {
      const queueId = `position:${job.id}`;
      const queued = await this.queue.getJob(queueId);
      const state = await this.queue.getJobState(queueId);
      if (queued && state === "failed") {
        this.store.failPositionProcessing(
          job,
          "worker_retry_exhausted",
          queued.failedReason ?? "Position retry budget exhausted.",
          new Date().toISOString(),
        );
      } else if (!queued || state === "unknown") {
        missing.push(job);
      }
    }
    if (missing.length) {
      await this.queue.addBulk(
        missing.map((data) => ({
          name: data.stage,
          data,
          opts: { jobId: `position:${data.id}`, attempts: 3, durable: true },
        })),
      );
    }
    this.store.markPositionJobsDispatched(
      jobs.map((job) => job.id),
      new Date().toISOString(),
    );
  }

  start() {
    if (this.timer || this.starting) return;
    this.starting = true;
    this.bootstrapPromise = this.bootstrap();
  }

  private async bootstrap() {
    while (this.starting && !this.timer) {
      try {
        await this.dispatch();
        if (!this.starting) return;
        this.worker.run();
        this.starting = false;
        this.timer = setInterval(
          () => void this.dispatch().catch(() => undefined),
          1_000,
        );
      } catch {
        await Bun.sleep(1_000);
      }
    }
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.starting = false;
    await this.bootstrapPromise;
    this.bootstrapPromise = null;
    await Promise.allSettled([this.worker.close(true), this.queue.close()]);
  }
}
