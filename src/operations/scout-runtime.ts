import { Queue, Worker, type Job } from "bunqueue/client";
import {
  BoundedFetchHttpPort,
  scanCompany,
  type GigScoutHttpPort,
} from "../core/scout/engine";
import type {
  ScoutCompanyJob,
  ScoutRunStore,
} from "../core/scout/engine/runs";
import { scoutTemplateCatalog } from "./scout-template-catalog";
import {
  LoggingScoutHttpPort,
  safeScoutLog,
  sanitizedLogData,
  sanitizedLogText,
  type ScoutLogger,
} from "./scout-logging";

export class ScoutRuntime {
  private readonly queue: Queue<ScoutCompanyJob>;
  private readonly worker: Worker<
    ScoutCompanyJob,
    { runId: string; runCompanyId: string; status: string }
  >;
  private timer: ReturnType<typeof setInterval> | null = null;
  private starting = false;
  private bootstrapPromise: Promise<void> | null = null;
  private readonly logger?: ScoutLogger;
  constructor(
    private readonly store: ScoutRunStore,
    options: {
      dataPath: string;
      batchSize: number;
      concurrency: number;
      http?: GigScoutHttpPort;
      heartbeatInterval?: number;
      stallInterval?: number;
      stallGracePeriod?: number;
      onWorkerStalled?: (jobId: string) => void;
      logger?: ScoutLogger;
    },
  ) {
    const logger = options.logger;
    this.logger = logger;
    safeScoutLog(
      logger,
      "info",
      {
        event: "scout.queue.initializing",
        batchSize: options.batchSize,
        concurrency: options.concurrency,
        heartbeatInterval: options.heartbeatInterval ?? null,
        stallInterval: options.stallInterval ?? null,
      },
      "Scout queue initializing",
    );
    this.queue = new Queue("gig-scout-companies", {
      embedded: true,
      dataPath: options.dataPath,
      defaultJobOptions: { attempts: 3, backoff: 1000, durable: true },
    });
    if (options.stallInterval !== undefined)
      this.queue.setStallConfig({
        enabled: true,
        stallInterval: options.stallInterval,
        gracePeriod: options.stallGracePeriod ?? 0,
        maxStalls: 1,
      });
    const http = new LoggingScoutHttpPort(
      options.http ?? new BoundedFetchHttpPort(),
      logger,
    );
    this.worker = new Worker(
      "gig-scout-companies",
      async (job: Job<ScoutCompanyJob>) => {
        const payload = job.data;
        const startedAt = performance.now();
        safeScoutLog(
          logger,
          "info",
          {
            event: "scout.queue.job_handling",
            jobId: job.id,
            runId: payload.runId,
            runCompanyId: payload.runCompanyId,
            companyId: payload.companyId,
            attemptNumber: job.attemptsMade + 1,
            searchProfile: sanitizedLogData(payload.searchProfile),
            sources: sanitizedLogData(payload.sources),
          },
          "Scout queue job handling started",
        );
        try {
          const result = await scanCompany(
            {
              companyId: payload.companyId,
              configurationVersionId: payload.configurationVersionId,
              sources: payload.sources,
              searchProfile: payload.searchProfile,
            },
            { http, templates: scoutTemplateCatalog },
          );
          this.store.commitResult(payload, result, new Date().toISOString());
          safeScoutLog(
            logger,
            "info",
            {
              event: "scout.queue.job_acknowledged",
              jobId: job.id,
              runId: payload.runId,
              runCompanyId: payload.runCompanyId,
              companyId: payload.companyId,
              durationMs: Math.round(performance.now() - startedAt),
              sourceCount: result.sources.length,
              positionCount: result.positions.length,
              outcomes: result.sources.map((source) => ({
                sourceKey: source.sourceKey,
                status: source.status,
                positionCount: source.positions.length,
                attemptCount: source.attempts.length,
                recordsReceived: source.attempts.reduce(
                  (sum, attempt) => sum + (attempt.recordsReceived ?? 0),
                  0,
                ),
                recordsEvaluated: source.attempts.reduce(
                  (sum, attempt) => sum + (attempt.recordsEvaluated ?? 0),
                  0,
                ),
                acceptedCount: source.attempts.reduce(
                  (sum, attempt) => sum + attempt.acceptedCount,
                  0,
                ),
                rejectedCount: source.attempts.reduce(
                  (sum, attempt) => sum + attempt.rejectedCount,
                  0,
                ),
                diagnosticCodes: [
                  ...new Set(
                    source.attempts.flatMap((attempt) =>
                      attempt.diagnostics.map((diagnostic) => diagnostic.code),
                    ),
                  ),
                ].slice(0, 50),
              })),
            },
            "Scout queue job result persisted",
          );
          return {
            runId: payload.runId,
            runCompanyId: payload.runCompanyId,
            status: "recorded",
          };
        } catch (error) {
          safeScoutLog(
            logger,
            "error",
            {
              event: "scout.queue.job_failed",
              jobId: job.id,
              runId: payload.runId,
              runCompanyId: payload.runCompanyId,
              companyId: payload.companyId,
              attemptNumber: job.attemptsMade + 1,
              retryExhausted: job.attemptsMade + 1 >= 3,
              errorCode:
                error instanceof Error
                  ? sanitizedLogText(error.message).slice(0, 200)
                  : "unknown",
            },
            "Scout queue job failed",
          );
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
        // BunQueue's embedded pull path does not honor lockDuration. Its
        // default token expires during valid multi-request company scans, so
        // embedded workers use heartbeat-backed stall detection instead.
        useLocks: false,
        heartbeatInterval: options.heartbeatInterval,
        autorun: false,
      },
    );
    if (options.onWorkerStalled)
      this.worker.on("stalled", options.onWorkerStalled);
    this.worker.on("ready", () =>
      safeScoutLog(
        logger,
        "info",
        { event: "scout.queue.worker_ready" },
        "Scout queue worker ready",
      ),
    );
    this.worker.on("active", (job) =>
      safeScoutLog(
        logger,
        "info",
        {
          event: "scout.queue.job_claimed",
          jobId: job.id,
          runId: job.data.runId,
          runCompanyId: job.data.runCompanyId,
          attemptNumber: job.attemptsMade + 1,
        },
        "Scout queue job claimed",
      ),
    );
    this.worker.on("completed", (job) =>
      safeScoutLog(
        logger,
        "info",
        {
          event: "scout.queue.job_completed",
          jobId: job.id,
          runId: job.data.runId,
          runCompanyId: job.data.runCompanyId,
        },
        "Scout queue job completed",
      ),
    );
    this.worker.on("failed", (job, error) =>
      safeScoutLog(
        logger,
        "error",
        {
          event: "scout.queue.job_attempt_failed",
          jobId: job.id,
          runId: job.data.runId,
          runCompanyId: job.data.runCompanyId,
          attemptNumber: job.attemptsMade,
          errorCode: sanitizedLogText(error.message).slice(0, 200),
        },
        "Scout queue job attempt failed",
      ),
    );
    this.worker.on("stalled", (jobId, reason) =>
      safeScoutLog(
        logger,
        "error",
        {
          event: "scout.queue.job_stalled",
          jobId,
          reason: sanitizedLogText(reason).slice(0, 200),
        },
        "Scout queue job stalled",
      ),
    );
    this.worker.on("drained", () =>
      safeScoutLog(
        logger,
        "info",
        { event: "scout.queue.worker_drained" },
        "Scout queue worker drained",
      ),
    );
    this.worker.on("error", (error) =>
      safeScoutLog(
        logger,
        "error",
        {
          event: "scout.queue.worker_error",
          errorCode: sanitizedLogText(error.message).slice(0, 200),
        },
        "Scout queue worker error",
      ),
    );
  }
  async dispatch() {
    await this.queue.waitUntilReady();
    const jobs = this.store.nonterminalJobs(1000);
    if (!jobs.length) return;
    const runIds = [...new Set(jobs.map((job) => job.runId))];
    const existing = await Promise.all(
      jobs.map(async (job) => ({
        job,
        queued: await this.queue.getJob(`scout:${job.runCompanyId}`),
        state: await this.queue.getJobState(`scout:${job.runCompanyId}`),
      })),
    );
    const exhausted = existing.filter(
      ({ queued, state }) => queued !== null && state === "failed",
    );
    for (const { job, queued } of exhausted)
      this.store.commitInfrastructureFailure(
        job,
        "worker_retry_exhausted",
        queued?.failedReason ?? "Worker retry budget was exhausted.",
        new Date().toISOString(),
      );
    const actionable = existing.filter(
      ({ queued, state }) =>
        !(queued !== null && state === "failed"),
    );
    const missingJobs = existing
      .filter(({ queued, state }) => queued === null || state === "unknown")
      .map(({ job }) => job);
    safeScoutLog(
      this.logger,
      "info",
      {
        event: "scout.queue.dispatch_started",
        jobCount: jobs.length,
        existingJobCount: actionable.length - missingJobs.length,
        newJobCount: missingJobs.length,
        exhaustedJobCount: exhausted.length,
        runIds,
      },
      "Scout queue dispatch started",
    );
    try {
      if (missingJobs.length)
        await this.queue.addBulk(
          missingJobs.map((data) => ({
            name: "scan-company",
            data,
            opts: {
              jobId: `scout:${data.runCompanyId}`,
              attempts: 3,
              durable: true,
            },
          })),
        );
      await this.waitForQueuedJobs(missingJobs);
    } catch (error) {
      safeScoutLog(
        this.logger,
        "error",
        {
          event: "scout.queue.dispatch_failed",
          jobCount: missingJobs.length,
          runIds,
          errorCode:
            error instanceof Error
              ? sanitizedLogText(error.message).slice(0, 200)
              : "unknown",
        },
        "Scout queue dispatch failed",
      );
      throw error;
    }
    this.store.markDispatched(
      jobs.map((job) => job.runCompanyId),
      new Date().toISOString(),
    );
    safeScoutLog(
      this.logger,
      "info",
      {
        event: "scout.queue.dispatch_completed",
        jobCount: jobs.length,
        existingJobCount: actionable.length - missingJobs.length,
        newJobCount: missingJobs.length,
        exhaustedJobCount: exhausted.length,
        runIds,
      },
      "Scout queue dispatch completed",
    );
  }
  private async waitForQueuedJobs(jobs: ScoutCompanyJob[]) {
    if (!jobs.length) return;
    const deadline = Date.now() + 5_000;
    let missing = jobs;
    while (missing.length && Date.now() < deadline) {
      missing = (
        await Promise.all(
          missing.map(async (job) => ({
            job,
            queued: await this.queue.getJob(`scout:${job.runCompanyId}`),
          })),
        )
      )
        .filter(({ queued }) => queued === null)
        .map(({ job }) => job);
      if (missing.length) await Bun.sleep(10);
    }
    if (missing.length) throw new Error("queue_dispatch_not_durable");
  }
  start() {
    if (this.timer || this.starting) return;
    this.starting = true;
    safeScoutLog(
      this.logger,
      "info",
      { event: "scout.queue.startup_reconciliation_started" },
      "Scout queue startup reconciliation started",
    );
    this.bootstrapPromise = this.bootstrap();
  }
  private async bootstrap() {
    while (this.starting && !this.timer) {
      try {
        await this.dispatch();
        if (!this.starting) return;
        safeScoutLog(
          this.logger,
          "info",
          {
            event: "scout.queue.startup_reconciliation_completed",
            nonterminalJobCount: this.store.nonterminalJobs(1_000).length,
          },
          "Scout queue startup reconciliation completed",
        );
        this.worker.run();
        if (!this.starting) return;
        this.starting = false;
        this.timer = setInterval(
          () => void this.dispatch().catch(() => undefined),
          1000,
        );
      } catch (error) {
        safeScoutLog(
          this.logger,
          "error",
          {
            event: "scout.queue.startup_reconciliation_failed",
            errorCode:
              error instanceof Error
                ? sanitizedLogText(error.message).slice(0, 200)
                : "unknown",
          },
          "Scout queue startup reconciliation failed",
        );
        await Bun.sleep(1_000);
      }
    }
  }
  async close() {
    safeScoutLog(
      this.logger,
      "info",
      { event: "scout.queue.shutdown_started" },
      "Scout queue shutdown started",
    );
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.starting = false;
    await this.bootstrapPromise;
    this.bootstrapPromise = null;
    const closed = await Promise.allSettled([
      this.worker.close(),
      this.queue.close(),
    ]);
    const failures = closed.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length) {
      safeScoutLog(
        this.logger,
        "error",
        {
          event: "scout.queue.shutdown_failed",
          failureCount: failures.length,
          errorCodes: failures.map((failure) =>
            sanitizedLogText(
              failure.reason instanceof Error
                ? failure.reason.message
                : String(failure.reason),
            ).slice(0, 200),
          ),
        },
        "Scout queue shutdown failed",
      );
      throw failures[0]!.reason;
    }
    safeScoutLog(
      this.logger,
      "info",
      { event: "scout.queue.shutdown_completed" },
      "Scout queue shutdown completed",
    );
  }
}
