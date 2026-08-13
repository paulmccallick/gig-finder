import { afterEach, expect, test } from "bun:test";
import { openDatabase, migrateDatabase } from "../database";
import { SqliteScoutCompanyImportStore } from "../scout-company-import-store";
import { SqliteScoutRunStore } from "../scout-run-store";
import { importScoutCompany } from "../../core/scout/engine/company-import";
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrateDatabase(db);
  importScoutCompany(
    {
      id: "company-1",
      name: "Example Company",
      active: true,
      sources: [
        {
          key: "official",
          type: "json",
          url: "https://careers.example.test/jobs",
          recordsPath: "jobs",
          fields: { id: "id", title: "title", url: "url" },
        },
      ],
    },
    new SqliteScoutCompanyImportStore(db),
  );
  return new SqliteScoutRunStore(db);
}
test("full-run creation is singleton guarded and outbox jobs carry immutable configuration", () => {
  const store = setup();
  const first = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z");
  const second = store.startOrReuse(99, 9, "2026-01-01T00:01:00Z");
  expect(first.created).toBeTrue();
  expect(second).toEqual({ run: first.run, created: false });
  const jobs = store.pendingJobs(20);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]?.sources[0]?.key).toBe("official");
});
test("a run-owned search profile is dispatched uniformly without changing company configuration", () => {
  const store = setup();
  store.startOrReuse(20, 5, "2026-01-01T00:00:00Z", {
    terms: ["synthetic specialty"],
    locations: ["Synthetic Region"],
  });
  const job = store.pendingJobs(1)[0]!;
  expect(job.searchProfile).toEqual({
    terms: ["synthetic specialty"],
    locations: ["Synthetic Region"],
  });
  expect(job.sources[0]).not.toHaveProperty("searchTerms");
  expect(job.sources[0]).not.toHaveProperty("maxPages");
});
test("terminal redelivery is idempotent and historical positions are stable", () => {
  const store = setup();
  const run = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  const result = {
    companyId: job.companyId,
    configurationVersionId: job.configurationVersionId,
    positions: [
      {
        sourceKey: "official",
        externalId: "role-1",
        canonicalUrl: "https://careers.example.test/jobs/1",
        title: "Systems Gardener",
        location: "Remote",
        description: null,
        provenance: {
          sourceKey: "official",
          sourceUrl: "https://careers.example.test/jobs",
          description: "none" as const,
          descriptionUrl: "https://careers.example.test/jobs/1",
        },
      },
    ],
    sources: [
      {
        sourceKey: "official",
        status: "succeeded_with_results" as const,
        positions: [] as never[],
        attempts: [
          {
            sourceMethod: "json" as const,
            stage: "listing-retry",
            requestCount: 1,
            responseCount: 0,
            candidateCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            validationStatus: "failed" as const,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:00Z",
            failure: { code: "temporary", message: "Retryable" },
            diagnostics: [
              {
                code: "synthetic_retry",
                category: "network" as const,
                count: 1,
                message: "Synthetic retry evidence.",
              },
            ],
          },
          {
            sourceMethod: "json" as const,
            stage: "listing",
            requestCount: 1,
            responseCount: 1,
            candidateCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            validationStatus: "verified" as const,
            startedAt: "2026-01-01T00:00:00Z",
            completedAt: "2026-01-01T00:00:01Z",
            diagnostics: [],
          },
        ],
      },
    ],
  };
  result.sources[0]!.positions = result.positions as never[];
  store.commitResult(job, result, "2026-01-01T00:00:01Z");
  store.commitResult(job, result, "2026-01-01T00:00:02Z");
  const detail = store.get(run.id)!;
  expect(detail.status).toBe("completed");
  expect(detail.companies[0]?.sources[0]).toMatchObject({
    candidateCount: 1,
    acceptedCount: 1,
  });
  expect(detail.companies[0]?.sources[0]?.attempts).toHaveLength(2);
  expect(
    detail.companies[0]?.sources[0]?.attempts[0]?.diagnostics,
  ).toContainEqual(
    expect.objectContaining({ code: "synthetic_retry", count: 1 }),
  );
  expect(store.positions(run.id, { offset: 0, limit: 20 }).items).toHaveLength(
    1,
  );
});
test("partial source outcomes roll up explicitly", () => {
  const store = setup();
  const run = store.startOrReuse(20, 5, "2026-01-01T00:00:00Z").run;
  const job = store.pendingJobs(1)[0]!;
  store.commitResult(
    job,
    {
      companyId: job.companyId,
      configurationVersionId: job.configurationVersionId,
      positions: [],
      sources: [
        {
          sourceKey: "official",
          status: "partial",
          positions: [],
          attempts: [
            {
              sourceMethod: "json",
              stage: "listing_page_2",
              requestCount: 1,
              responseCount: 0,
              candidateCount: 0,
              acceptedCount: 0,
              rejectedCount: 0,
              validationStatus: "failed",
              startedAt: "2026-01-01T00:00:00Z",
              completedAt: "2026-01-01T00:00:01Z",
              failure: {
                code: "source_attempt_failed",
                message: "Synthetic failure",
              },
              diagnostics: [],
            },
          ],
        },
      ],
    },
    "2026-01-01T00:00:01Z",
  );
  expect(store.get(run.id)?.status).toBe("partial");
  expect(store.get(run.id)?.companies[0]?.status).toBe("partial");
});
