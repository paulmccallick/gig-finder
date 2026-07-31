import { describe, expect, test } from "bun:test";
import {
  gigUpdateSchema,
  meetingUpdateSchema,
  networkingContactUpdateSchema,
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

  test("accepts partial meeting updates and nullable clears", () => {
    expect(meetingUpdateSchema.parse({
      status: "completed",
      personIds: ["person-1", "person-2"],
      gigId: null,
      location: null,
    })).toEqual({
      status: "completed",
      personIds: ["person-1", "person-2"],
      gigId: null,
      location: null,
    });
  });

  test("rejects immutable and malformed meeting updates", () => {
    for (const patch of [
      {},
      { id: "other" },
      { externalCalendarId: "calendar" },
      { revision: 2 },
      { status: "tentative" },
      { startsAt: "tomorrow" },
      { timezone: "Mars/Olympus" },
      { personIds: [] },
    ]) {
      expect(meetingUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});
