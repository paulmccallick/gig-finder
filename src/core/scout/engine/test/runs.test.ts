import { describe, expect, test } from "bun:test";
import {
  defaultScoutSearchProfile,
  resolveScoutSearchProfile,
} from "../../sourcing/contracts";
import { ScoutRunService, type ScoutRunStore } from "../runs";

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
    commitResult: () => {},
    commitInfrastructureFailure: () => {},
    positions: () => ({ items: [], offset: 0, limit: 20, total: 0 }),
  }) satisfies ScoutRunStore;

describe("Scout run search profiles", () => {
  test("uses independent copies of the temporary defaults for omitted and empty dimensions", () => {
    expect(resolveScoutSearchProfile()).toEqual({
      terms: [...defaultScoutSearchProfile.terms],
      locations: [...defaultScoutSearchProfile.locations],
    });
    expect(resolveScoutSearchProfile({ terms: [], locations: [] })).toEqual(
      {
        terms: [...defaultScoutSearchProfile.terms],
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
      locations: [...defaultScoutSearchProfile.locations],
    });
    expect(resolveScoutSearchProfile({ locations: ["Synthetic Region"] })).toEqual(
      {
        terms: [...defaultScoutSearchProfile.terms],
        locations: ["Synthetic Region"],
      },
    );
  });

  test("startFull persists the resolved profile at the service boundary", () => {
    const captured: unknown[] = [];
    new ScoutRunService(store(captured)).startFull({
      searchProfile: { terms: ["Architect"], locations: [] },
    });
    expect(captured).toEqual([
      {
        terms: ["Architect"],
        locations: [...defaultScoutSearchProfile.locations],
      },
    ]);
  });
});
