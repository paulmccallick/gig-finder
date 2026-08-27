import { describe, expect, test } from "bun:test";
import type { GigRecord } from "../../../gigs";
import type { CompanyScanResult } from "../../sourcing/contracts";
import {
  defaultScoutSearchProfile,
  resolveScoutSearchProfile,
} from "../../sourcing/contracts";
import {
  ScoutRunService,
  type PreparedScoutCompanyResult,
  type ScoutCompanyJob,
  type ScoutGigAvailabilityPort,
  type ScoutRunStore,
} from "../runs";

const store = (captured: Array<unknown>): ScoutRunStore =>
  ({
    startOrReuse(batchSize, concurrency, createdAt, searchProfile) {
      captured.push(searchProfile);
      return {
        created: true,
        run: {
          id: "synthetic-run",
          status: "completed",
          batchSize,
          concurrency,
          createdAt,
          startedAt: createdAt,
          completedAt: createdAt,
          companyCount: 0,
          succeededCount: 0,
          failedCount: 0,
          searchProfile: searchProfile!,
        },
      };
    },
    list: () => [],
    get: () => null,
    pendingJobs: () => [],
    nonterminalJobs: () => [],
    markDispatched: () => {},
    prepareCompanyResult: () => ({ companyName: "Synthetic Company", status: "succeeded", observedPositions: [] }),
    completeCompanyResult: () => {},
    commitInfrastructureFailure: () => {},
    positions: () => ({ items: [], offset: 0, limit: 20, total: 0 }),
  }) satisfies ScoutRunStore;

const job: ScoutCompanyJob = {
  runId: "run-1",
  runCompanyId: "run-company-1",
  companyId: "company-1",
  configurationVersionId: "configuration-1",
  sources: [],
  searchProfile: { terms: [], locations: [] },
};

const scanResult: CompanyScanResult = {
  companyId: job.companyId,
  configurationVersionId: job.configurationVersionId,
  positions: [],
  sources: [],
};

const gig = (
  id: string,
  input: Partial<Pick<GigRecord, "company" | "sourceUrl" | "externalJobId">> = {},
): GigRecord => ({
  id,
  company: input.company ?? "Synthetic Company",
  title: `Synthetic role ${id}`,
  externalJobId: input.externalJobId ?? null,
  artifactDirectory: null,
  stage: "identified",
  outcome: "pending",
  statusSummary: "Tracked",
  lastActivity: "2026-08-27",
  nextAction: null,
  fit: { rating: "good", summary: null },
  payRange: null,
  sourceUrl: input.sourceUrl ?? null,
  tags: [],
  hasJobDescription: false,
  hasInterviewPrep: false,
  availability: "unknown",
  availabilityUpdatedAt: null,
  location: null,
  workArrangement: null,
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
  documents: [],
  interactions: [],
});

const orchestrationStore = (
  prepared: PreparedScoutCompanyResult,
  calls: string[],
): ScoutRunStore => ({
  ...store([]),
  prepareCompanyResult: () => prepared,
  completeCompanyResult: () => calls.push("completeCompanyResult"),
});

describe("Scout company result completion", () => {
  test("matches exact canonical URLs and external IDs before completing the company", () => {
    const calls: string[] = [];
    const availabilityCalls: Array<{
      actor: string;
      source: string;
      summary: string;
      occurredAt: string | undefined;
      changeId: string | undefined;
      gigId: string;
      availability: "available" | "unavailable";
    }> = [];
    const tracked = [
      gig("gig-url", { sourceUrl: "https://careers.example.test/jobs/url" }),
      gig("gig-external", { externalJobId: "external-1" }),
      gig("gig-missing", { externalJobId: "external-missing" }),
    ];
    const gigs: ScoutGigAvailabilityPort = {
      list: () => tracked,
      setAvailability(context, gigId, availability) {
        calls.push(`setAvailability:${gigId}`);
        availabilityCalls.push({
          actor: context.actor,
          source: context.source,
          summary: context.summary,
          occurredAt: context.occurredAt,
          changeId: context.changeId,
          gigId,
          availability,
        });
        return { record: tracked.find((item) => item.id === gigId)!, changeId: context.changeId ?? null };
      },
    };
    const service = new ScoutRunService(
      orchestrationStore(
        {
          companyName: " synthetic company ",
          status: "succeeded",
          observedPositions: [
            {
              canonicalUrl: "https://careers.example.test/jobs/url",
              externalId: null,
            },
            {
              canonicalUrl: "https://careers.example.test/jobs/another-url",
              externalId: "external-1",
            },
          ],
        },
        calls,
      ),
      gigs,
    );

    service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z");

    expect(availabilityCalls).toEqual([
      {
        actor: "Gig Scout",
        source: "automation",
        summary: "Observed official position availability",
        occurredAt: "2026-08-27T13:00:00Z",
        changeId: "scout-availability:run-1:gig-url",
        gigId: "gig-url",
        availability: "available",
      },
      {
        actor: "Gig Scout",
        source: "automation",
        summary: "Observed official position availability",
        occurredAt: "2026-08-27T13:00:00Z",
        changeId: "scout-availability:run-1:gig-external",
        gigId: "gig-external",
        availability: "available",
      },
      {
        actor: "Gig Scout",
        source: "automation",
        summary: "Observed official position availability",
        occurredAt: "2026-08-27T13:00:00Z",
        changeId: "scout-availability:run-1:gig-missing",
        gigId: "gig-missing",
        availability: "unavailable",
      },
    ]);
    expect(calls).toEqual([
      "setAvailability:gig-url",
      "setAvailability:gig-external",
      "setAvailability:gig-missing",
      "completeCompanyResult",
    ]);
  });

  test("skips tracked Gigs without an identity or under another company", () => {
    const availabilityCalls: string[] = [];
    const gigs: ScoutGigAvailabilityPort = {
      list: () => [
        gig("gig-no-identity"),
        gig("gig-other-company", {
          company: "Other Company",
          externalJobId: "external-1",
        }),
      ],
      setAvailability(_context, gigId) {
        availabilityCalls.push(gigId);
        return { record: gig(gigId), changeId: null };
      },
    };
    const completionCalls: string[] = [];
    const service = new ScoutRunService(
      orchestrationStore(
        {
          companyName: "Synthetic Company",
          status: "succeeded",
          observedPositions: [],
        },
        completionCalls,
      ),
      gigs,
    );

    service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z");

    expect(availabilityCalls).toEqual([]);
    expect(completionCalls).toEqual(["completeCompanyResult"]);
  });

  test("completes partial and failed results without changing Gig availability", () => {
    for (const status of ["partial", "failed"] as const) {
      const completedStatuses: string[] = [];
      const prepared = {
        companyName: "Synthetic Company",
        status,
        observedPositions: [],
      };
      const service = new ScoutRunService(
        {
          ...store([]),
          prepareCompanyResult: () => prepared,
          completeCompanyResult: (_job, result) =>
            completedStatuses.push(result.status),
        },
        {
          list: () => [gig("gig-1", { externalJobId: "external-1" })],
          setAvailability: () => {
            throw new Error("untrustworthy results must not mutate Gigs");
          },
        },
      );

      service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z");

      expect(completedStatuses).toEqual([status]);
    }
  });

  test("leaves company completion nonterminal when a Gig mutation fails", () => {
    const calls: string[] = [];
    const service = new ScoutRunService(
      orchestrationStore(
        {
          companyName: "Synthetic Company",
          status: "succeeded",
          observedPositions: [],
        },
        calls,
      ),
      {
        list: () => [gig("gig-1", { externalJobId: "external-1" })],
        setAvailability: () => {
          calls.push("setAvailability:gig-1");
          throw new Error("synthetic Gig mutation failure");
        },
      },
    );

    expect(() =>
      service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z"),
    ).toThrow("synthetic Gig mutation failure");
    expect(calls).toEqual(["setAvailability:gig-1"]);
  });

  test("retries deterministic Gig mutations and completes once after recovery", () => {
    const tracked = [
      gig("gig-1", { externalJobId: "external-1" }),
      gig("gig-2", { externalJobId: "external-2" }),
    ];
    const changeIds: Array<string | undefined> = [];
    let secondGigAttempts = 0;
    let completions = 0;
    const prepared: PreparedScoutCompanyResult = {
      companyName: "Synthetic Company",
      status: "succeeded",
      observedPositions: [],
    };
    const retryStore: ScoutRunStore = {
      ...store([]),
      prepareCompanyResult: () => prepared,
      completeCompanyResult: () => completions++,
    };
    const service = new ScoutRunService(retryStore, {
      list: () => tracked,
      setAvailability(context, gigId) {
        changeIds.push(context.changeId);
        if (gigId === "gig-2" && secondGigAttempts++ === 0)
          throw new Error("synthetic transient failure");
        return {
          record: tracked.find((item) => item.id === gigId)!,
          changeId: gigId === "gig-1" && changeIds.length > 2 ? null : context.changeId ?? null,
        };
      },
    });

    expect(() =>
      service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z"),
    ).toThrow("synthetic transient failure");
    service.commitCompanyResult(job, scanResult, "2026-08-27T13:00:00Z");

    expect(changeIds).toEqual([
      "scout-availability:run-1:gig-1",
      "scout-availability:run-1:gig-2",
      "scout-availability:run-1:gig-1",
      "scout-availability:run-1:gig-2",
    ]);
    expect(completions).toBe(1);
  });
});

describe("Scout run search profiles", () => {
  const defaultTitleVariants = () =>
    defaultScoutSearchProfile.titleVariants.map(({ term, variants }) => ({
      term,
      variants: [...variants],
    }));

  test("uses independent copies of the temporary defaults for omitted and empty dimensions", () => {
    expect(resolveScoutSearchProfile()).toEqual({
      terms: [...defaultScoutSearchProfile.terms],
      titleVariants: defaultTitleVariants(),
      locations: [...defaultScoutSearchProfile.locations],
    });
    expect(resolveScoutSearchProfile({ terms: [], locations: [] })).toEqual(
      {
        terms: [...defaultScoutSearchProfile.terms],
        titleVariants: defaultTitleVariants(),
        locations: [...defaultScoutSearchProfile.locations],
      },
    );
    expect(resolveScoutSearchProfile().terms).not.toBe(
      defaultScoutSearchProfile.terms,
    );
  });

  test("non-empty explicit dimensions replace only that dimension", () => {
    expect(resolveScoutSearchProfile({ terms: ["Architect"] })).toEqual({
      terms: ["Architect"],
      titleVariants: defaultTitleVariants(),
      locations: [...defaultScoutSearchProfile.locations],
    });
    expect(resolveScoutSearchProfile({ locations: ["Synthetic Region"] })).toEqual(
      {
        terms: [...defaultScoutSearchProfile.terms],
        titleVariants: defaultTitleVariants(),
        locations: ["Synthetic Region"],
      },
    );
  });

  test("startFull persists the resolved profile at the service boundary", () => {
    const captured: unknown[] = [];
    new ScoutRunService(store(captured), {
      list: () => [],
      setAvailability: () => {
        throw new Error("No tracked Gigs are expected in this test.");
      },
    }).startFull({
      searchProfile: { terms: ["Architect"], locations: [] },
    });
    expect(captured).toEqual([
      {
        terms: ["Architect"],
        titleVariants: defaultTitleVariants(),
        locations: [...defaultScoutSearchProfile.locations],
      },
    ]);
  });
});
