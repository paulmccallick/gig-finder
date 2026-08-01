import { describe, expect, test } from "bun:test";
import {
  gigUpdateSchema,
  personUpdateSchema,
} from "../src/update-contracts";

describe("shared update contracts", () => {
  test("accepts explicit partial and nested gig updates", () => {
    expect(gigUpdateSchema.parse({
      stage: "applied",
      fit: { rating: "strong" },
      nextAction: { due: null },
    })).toEqual({
      stage: "applied",
      fit: { rating: "strong" },
      nextAction: { due: null },
    });
  });

  test("rejects empty, immutable, derived, unknown, and malformed gig fields", () => {
    for (const patch of [
      {},
      { id: "other" },
      { artifactDirectory: "private" },
      { hasJobDescription: true },
      { unexpected: true },
      { stage: "unknown" },
      { nextAction: {} },
      { lastActivity: "07/27/2026" },
    ]) {
      expect(gigUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("accepts explicit partial and nested person updates", () => {
    expect(personUpdateSchema.parse({
      status: "awaiting_response",
      relationship: { strength: "strong" },
      outreach: { nextAction: null },
    })).toEqual({
      status: "awaiting_response",
      relationship: { strength: "strong" },
      outreach: { nextAction: null },
    });
  });

  test("rejects person metadata and invalid nested fields", () => {
    for (const patch of [
      {},
      { id: "other" },
      { profileStatus: "verified" },
      { createdAt: "2026-07-27" },
      { updatedAt: "2026-07-27" },
      { source: { files: [] } },
      { relationship: {} },
      { outreach: { nextActionDue: "tomorrow" } },
    ]) {
      expect(personUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});
