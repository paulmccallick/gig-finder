import { describe, expect, test } from "bun:test";
import { gigInputSchema } from "../gigs";
import { interactionInputSchema } from "../interactions";
import { personInputSchema } from "../people";
import { taskInputSchema } from "../tasks";

describe("domain input contracts", () => {
  test("accepts explicit partial and nested gig updates", () => {
    expect(gigInputSchema.parse({
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
      expect(gigInputSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("accepts explicit partial and nested person updates", () => {
    expect(personInputSchema.parse({
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
      expect(personInputSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("accepts partial Interaction updates and nullable clears", () => {
    expect(interactionInputSchema.parse({
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

  test("rejects immutable and malformed Interaction updates", () => {
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
      expect(interactionInputSchema.safeParse(patch).success).toBe(false);
    }
  });

  test("accepts task creation and partial updates without caller-owned labels", () => {
    expect(taskInputSchema.parse({
      title: "Follow up",
      type: "networking_follow_up",
      dueDate: "2026-08-05",
      relatedEntity: { type: "person", id: "person-1" },
      notes: null,
    })).toEqual({
      title: "Follow up",
      type: "networking_follow_up",
      dueDate: "2026-08-05",
      relatedEntity: { type: "person", id: "person-1" },
      notes: null,
    });
    expect(taskInputSchema.parse({
      status: "completed",
      dueDate: null,
      relatedEntity: { type: "gig", id: "gig-1" },
    })).toEqual({
      status: "completed",
      dueDate: null,
      relatedEntity: { type: "gig", id: "gig-1" },
    });
  });

  test("rejects invalid task values, relationships, and immutable fields", () => {
    const creation = {
      title: "Follow up",
      type: "networking_follow_up",
      dueDate: null,
      relatedEntity: { type: "general", id: null },
      notes: null,
    };
    for (const input of [
      { ...creation, title: "" },
      { ...creation, type: "invalid" },
      { ...creation, dueDate: "tomorrow" },
      { ...creation, dueDate: "2026-02-31" },
      { ...creation, relatedEntity: { type: "general", id: "gig-1" } },
      { ...creation, relatedEntity: { type: "gig", id: null } },
    ]) {
      expect(taskInputSchema.safeParse(input).success).toBe(false);
    }
    for (const patch of [
      {},
      { id: "other" },
      { createdAt: "2026-08-03" },
      { updatedAt: "2026-08-03" },
      { completedAt: "2026-08-03" },
      { status: "invalid" },
      { dueDate: "tomorrow" },
      { dueDate: "2026-02-31" },
      { relatedEntity: { type: "person", id: null } },
    ]) {
      expect(taskInputSchema.safeParse(patch).success).toBe(false);
    }
  });
});
