import { describe, expect, test } from "bun:test";
import {
  gigUpdateSchema,
  meetingUpdateSchema,
  personUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
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

  test("accepts task creation and partial updates without caller-owned labels", () => {
    expect(taskCreateSchema.parse({
      title: "Follow up",
      type: "networking_follow_up",
      priority: null,
      dueDate: "2026-08-05",
      relatedEntity: { type: "person", id: "person-1" },
      notes: null,
    })).toEqual({
      title: "Follow up",
      type: "networking_follow_up",
      priority: null,
      dueDate: "2026-08-05",
      relatedEntity: { type: "person", id: "person-1" },
      notes: null,
    });
    expect(taskUpdateSchema.parse({
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
      priority: null,
      dueDate: null,
      relatedEntity: { type: "general", id: null },
      notes: null,
    };
    for (const input of [
      { ...creation, title: "" },
      { ...creation, status: "open" },
      { ...creation, type: "invalid" },
      { ...creation, dueDate: "tomorrow" },
      { ...creation, relatedEntity: { type: "general", id: "gig-1" } },
      { ...creation, relatedEntity: { type: "gig", id: null } },
    ]) {
      expect(taskCreateSchema.safeParse(input).success).toBe(false);
    }
    for (const patch of [
      {},
      { id: "other" },
      { createdAt: "2026-08-03" },
      { updatedAt: "2026-08-03" },
      { completedAt: "2026-08-03" },
      { status: "invalid" },
      { dueDate: "tomorrow" },
      { relatedEntity: { type: "person", id: null } },
    ]) {
      expect(taskUpdateSchema.safeParse(patch).success).toBe(false);
    }
  });
});
