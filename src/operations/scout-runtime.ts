import { Queue, Worker, type Job } from "bunqueue/client";
import { BoundedFetchHttpPort, scanCompany } from "../gig-scout";
import type { ScoutCompanyJob, ScoutRunStore } from "../core/scout-runs";

export class ScoutRuntime {
  private readonly queue: Queue<ScoutCompanyJob>;
  private readonly worker: Worker<
    ScoutCompanyJob,
    { runId: string; runCompanyId: string; status: string }
  >;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly store: ScoutRunStore,
    options: {
      dataPath: string;
      batchSize: number;
      concurrency: number;
      http?: BoundedFetchHttpPort;
    },
  ) {
    this.queue = new Queue("gig-scout-companies", {
      embedded: true,
      dataPath: options.dataPath,
      defaultJobOptions: { attempts: 3, backoff: 1000, durable: true },
    });
    const http = options.http ?? new BoundedFetchHttpPort();
    this.worker = new Worker(
      "gig-scout-companies",
      async (job: Job<ScoutCompanyJob>) => {
        const payload = job.data;
        try {
          const result = await scanCompany(
            {
              companyId: payload.companyId,
              configurationVersionId: payload.configurationVersionId,
              sources: payload.sources,
            },
            { http },
          );
          this.store.commitResult(payload, result, new Date().toISOString());
          return {
            runId: payload.runId,
            runCompanyId: payload.runCompanyId,
            status: "recorded",
          };
        } catch (error) {
          if (job.attemptsMade + 1 >= 3)
            this.store.commitInfrastructureFailure(
              payload,
              "worker_retry_exhausted",
              error instanceof Error ? error.message : "Worker failed.",
              new Date().toISOString(),
            );
          throw error;
        }
      },
      {
        embedded: true,
        dataPath: options.dataPath,
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        autorun: false,
      },
    );
  }
  async dispatch() {
    const jobs = this.store.pendingJobs(1000);
    if (!jobs.length) return;
    await this.queue.addBulk(
      jobs.map((data) => ({
        name: "scan-company",
        data,
        opts: {
          jobId: `scout:${data.runCompanyId}`,
          attempts: 3,
          durable: true,
        },
      })),
    );
    this.store.markDispatched(
      jobs.map((job) => job.runCompanyId),
      new Date().toISOString(),
    );
  }
  start() {
    if (this.timer) return;
    this.store.recoverDispatch();
    this.worker.run();
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), 1000);
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.worker.close();
    await this.queue.close();
  }
}
