import type { CompanyScanResult, SourceConfiguration } from "../gig-scout";

export type ScoutRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";
export interface ScoutCompanyJob {
  runId: string;
  runCompanyId: string;
  companyId: string;
  configurationVersionId: string;
  sources: SourceConfiguration[];
}
export interface ScoutRunSummary {
  id: string;
  status: ScoutRunStatus;
  batchSize: number;
  concurrency: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  companyCount: number;
  succeededCount: number;
  failedCount: number;
}
export interface ScoutRunSourceDetail {
  id: string;
  sourceKey: string;
  status: string;
  candidateCount: number;
  acceptedCount: number;
  rejectedCount: number;
  attempts: Array<{
    attemptNumber: number;
    stage: string;
    validationStatus: string;
    failureCode: string | null;
    failureMessage: string | null;
  }>;
}
export interface ScoutRunDetail extends ScoutRunSummary {
  companies: Array<{
    id: string;
    companyId: string;
    status: string;
    failureCode: string | null;
    failureMessage: string | null;
    sources: ScoutRunSourceDetail[];
  }>;
}
export interface ScoutPositionPage {
  items: Array<{
    id: string;
    title: string;
    company: string;
    canonicalUrl: string;
    location: string | null;
    observedAt: string;
    sourceStatus: string;
    descriptionArtifactId: string | null;
    provenance: unknown;
  }>;
  offset: number;
  limit: number;
  total: number;
}
export interface ScoutRunStore {
  startOrReuse(
    batchSize: number,
    concurrency: number,
    now: string,
  ): { run: ScoutRunSummary; created: boolean };
  list(): ScoutRunSummary[];
  get(runId: string): ScoutRunDetail | null;
  pendingJobs(limit: number): ScoutCompanyJob[];
  markDispatched(runCompanyIds: string[], now: string): void;
  recoverDispatch(): void;
  commitResult(
    job: ScoutCompanyJob,
    result: CompanyScanResult,
    now: string,
  ): void;
  commitInfrastructureFailure(
    job: ScoutCompanyJob,
    code: string,
    message: string,
    now: string,
  ): void;
  positions(
    runId: string,
    input: { company?: string; text?: string; offset: number; limit: number },
  ): ScoutPositionPage;
}
export class ScoutRunService {
  constructor(
    private readonly store: ScoutRunStore,
    private readonly defaults = { batchSize: 20, concurrency: 5 },
  ) {}
  startFull(
    settings: Partial<{ batchSize: number; concurrency: number }> = {},
  ) {
    const batchSize = settings.batchSize ?? this.defaults.batchSize;
    const concurrency = settings.concurrency ?? this.defaults.concurrency;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
      throw new Error("Scout batch size must be from 1 through 100.");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50)
      throw new Error("Scout concurrency must be from 1 through 50.");
    return this.store.startOrReuse(
      batchSize,
      concurrency,
      new Date().toISOString(),
    );
  }
  list() {
    return this.store.list();
  }
  get(id: string) {
    return this.store.get(id);
  }
  positions(
    id: string,
    input: Partial<{
      company: string;
      text: string;
      offset: number;
      limit: number;
    }> = {},
  ) {
    const offset = input.offset ?? 0,
      limit = input.limit ?? 20;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid Scout pagination.");
    return this.store.positions(id, {
      company: input.company?.trim().slice(0, 200),
      text: input.text?.trim().slice(0, 200),
      offset,
      limit,
    });
  }
}
