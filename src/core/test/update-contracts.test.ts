import { describe, expect, test } from "bun:test";
import {
  jobUpdateSchema,
  networkingContactUpdateSchema,
} from "../src/update-contracts";

describe("shared update contracts", () => {
  test("accepts explicit partial and nested job updates", () => {
    expect(jobUpdateSchema.parse({
      stage: "applied",
      fit: { rating: "strong" },
      nextAction: { due: null },
    })).toEqual({
      stage: "applied",
      fit: { rating: "strong" },
      nextAction: { due: null },
    });
  });

  test("rejects empty, immutable, derived, unknown, and malformed job fields", () => {
    for (const patch of [
      {},
      { id: "other" },
      { roleDirectory: "private" },
      { hasJobDescription: true },
      { unexpected: true },
      { stage: "unknown" },
      { nextAction: {} },
      { lastActivity: "07/27/2026" },
    ]) {
      expect(jobUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("accepts explicit partial and nested contact updates", () => {
    expect(networkingContactUpdateSchema.parse({
      status: "awaiting_response",
      relationship: { strength: "strong" },
      outreach: { nextAction: null },
    })).toEqual({
      status: "awaiting_response",
      relationship: { strength: "strong" },
      outreach: { nextAction: null },
    });
  });

  test("rejects contact metadata and invalid nested fields", () => {
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
      expect(networkingContactUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});
