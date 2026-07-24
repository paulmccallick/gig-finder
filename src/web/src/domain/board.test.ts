import { describe, expect, test } from "bun:test";
import { archiveGroup, compareRoles, filterRoles, formatPay, isOverdue, todayInPacific } from "./board";
import type { JobRole } from "../../../core/src/jobs";

const role = (overrides: Partial<JobRole> = {}): JobRole => ({
  id: "test-role",
  company: "Acme",
  title: "VP Engineering",
  jobId: null,
  roleDirectory: null,
  stage: "identified",
  outcome: null,
  statusSummary: "Promising platform role",
  lastActivity: "2026-07-10",
  nextAction: { description: "Review role", due: "2026-07-13" },
  fit: { rating: "good", summary: null },
  payRange: null,
  sourceUrl: null,
  tags: [],
  ...overrides,
});

describe("board domain", () => {
  test("calculates the Pacific date across a UTC boundary", () => {
    expect(todayInPacific(new Date("2026-07-15T05:00:00Z"))).toBe("2026-07-14");
  });

  test("marks only active past-due actions overdue", () => {
    expect(isOverdue(role(), "2026-07-14")).toBe(true);
    expect(isOverdue(role({ stage: "closed" }), "2026-07-14")).toBe(false);
    expect(isOverdue(role({ nextAction: null }), "2026-07-14")).toBe(false);
  });

  test("separates active and archive records", () => {
    const roles = [role(), role({ id: "closed", stage: "closed", outcome: "rejected" })];
    expect(filterRoles(roles, "active", { search: "", stage: "all", fit: "all", overdueOnly: false })).toHaveLength(1);
    expect(filterRoles(roles, "archive", { search: "", stage: "all", fit: "all", overdueOnly: false })).toHaveLength(1);
  });

  test("combines search, stage, fit, and overdue filters", () => {
    const roles = [role(), role({ id: "other", company: "Beta", stage: "applied", fit: { rating: "stretch", summary: null } })];
    const result = filterRoles(roles, "active", { search: "acme", stage: "identified", fit: "good", overdueOnly: true }, "2026-07-14");
    expect(result.map((item) => item.id)).toEqual(["test-role"]);
  });

  test("sorts overdue records before newer records", () => {
    const urgent = role({ id: "urgent" });
    const current = role({ id: "current", lastActivity: "2026-07-14", nextAction: { description: "Later", due: "2026-07-20" } });
    expect([current, urgent].sort((a, b) => compareRoles(a, b, "2026-07-14"))[0]?.id).toBe("urgent");
  });

  test("groups less-common outcomes under other", () => {
    expect(archiveGroup(role({ stage: "closed", outcome: "withdrawn" }))).toBe("other");
    expect(archiveGroup(role({ stage: "closed", outcome: "role_pulled" }))).toBe("role_pulled");
  });

  test("formats annual compensation and handles unknown pay", () => {
    expect(formatPay(role())).toBeNull();
    expect(formatPay(role({ payRange: { currency: "USD", minimum: 200000, maximum: 300000, period: "year", notes: null } }))).toBe("$200K–$300K/yr");
  });
});
