import { describe, expect, test } from "bun:test";
import { archiveGroup, compareGigs, filterGigs, formatPay, isOverdue, todayInPacific } from "../../../client/domain/board";
import type { GigSummary } from "../../../../core/gigs";

const gig = (overrides: Partial<GigSummary> = {}): GigSummary => ({
  id: "test-gig",
  company: "Acme",
  title: "VP Engineering",
  externalJobId: null,
  stage: "identified",
  outcome: "pending",
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
    expect(isOverdue(gig(), "2026-07-14")).toBe(true);
    expect(isOverdue(gig({ stage: "closed" }), "2026-07-14")).toBe(false);
    expect(isOverdue(gig({ nextAction: null }), "2026-07-14")).toBe(false);
  });

  test("separates active and archive records", () => {
    const gigs = [gig(), gig({ id: "closed", stage: "closed", outcome: "rejected" })];
    expect(filterGigs(gigs, "active", { search: "", stage: "all", fit: "all", overdueOnly: false })).toHaveLength(1);
    expect(filterGigs(gigs, "archive", { search: "", stage: "all", fit: "all", overdueOnly: false })).toHaveLength(1);
  });

  test("combines search, stage, fit, and overdue filters", () => {
    const gigs = [gig(), gig({ id: "other", company: "Beta", stage: "applied", fit: { rating: "stretch", summary: null } })];
    const result = filterGigs(gigs, "active", { search: "acme", stage: "identified", fit: "good", overdueOnly: true }, "2026-07-14");
    expect(result.map((item) => item.id)).toEqual(["test-gig"]);
  });

  test("sorts overdue records before newer records", () => {
    const urgent = gig({ id: "urgent" });
    const current = gig({ id: "current", lastActivity: "2026-07-14", nextAction: { description: "Later", due: "2026-07-20" } });
    expect([current, urgent].sort((a, b) => compareGigs(a, b, "2026-07-14"))[0]?.id).toBe("urgent");
  });

  test("groups less-common outcomes under other", () => {
    expect(archiveGroup(gig({ stage: "closed", outcome: "withdrawn" }))).toBe("other");
    expect(archiveGroup(gig({ stage: "closed", outcome: "role_pulled" }))).toBe("role_pulled");
  });

  test("formats annual compensation and handles unknown pay", () => {
    expect(formatPay(gig())).toBeNull();
    expect(formatPay(gig({ payRange: { currency: "USD", minimum: 200000, maximum: 300000, period: "year", notes: null } }))).toBe("$200K–$300K/yr");
  });
});
