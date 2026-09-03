import { describe, expect, test } from "bun:test";
import { archiveGroup, compareGigs, compareUnavailableGigs, filterGigs, formatPay, formatUnavailableSince, isOverdue, todayInPacific } from "../../../client/domain/board";
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
  availability: "unknown",
  availabilityUpdatedAt: null,
  ...overrides,
});

const emptyFilters = { search: "", stage: "all" as const, fit: "all" as const, overdueOnly: false };

describe("board domain", () => {
  test("calculates the Pacific date across a UTC boundary", () => {
    expect(todayInPacific(new Date("2026-07-15T05:00:00Z"))).toBe("2026-07-14");
  });

  test("marks only active past-due actions overdue", () => {
    expect(isOverdue(gig(), "2026-07-14")).toBe(true);
    expect(isOverdue(gig({ stage: "closed" }), "2026-07-14")).toBe(false);
    expect(isOverdue(gig({ nextAction: null }), "2026-07-14")).toBe(false);
  });

  test("separates active, unavailable, and archive records", () => {
    const gigs = [
      gig({ id: "unknown" }),
      gig({ id: "available", availability: "available" }),
      gig({ id: "unavailable", availability: "unavailable", availabilityUpdatedAt: "2026-07-14T16:00:00.000Z" }),
      gig({ id: "closed-unavailable", stage: "closed", outcome: "role_pulled", nextAction: null, availability: "unavailable", availabilityUpdatedAt: "2026-07-13T16:00:00.000Z" }),
    ];
    expect(filterGigs(gigs, "active", emptyFilters).map(item => item.id)).toEqual(["unknown", "available"]);
    expect(filterGigs(gigs, "unavailable", emptyFilters).map(item => item.id)).toEqual(["unavailable"]);
    expect(filterGigs(gigs, "archive", emptyFilters).map(item => item.id)).toEqual(["closed-unavailable"]);
  });

  test("combines search, stage, fit, and overdue filters", () => {
    const gigs = [gig(), gig({ id: "other", company: "Beta", stage: "applied", fit: { rating: "stretch", summary: null } })];
    const result = filterGigs(gigs, "active", { search: "acme", stage: "identified", fit: "good", overdueOnly: true }, "2026-07-14");
    expect(result.map((item) => item.id)).toEqual(["test-gig"]);
  });

  test("combines search, stage, fit, and overdue filters for unavailable records", () => {
    const gigs = [
      gig({ id: "matching", availability: "unavailable", company: "Acme", stage: "identified", fit: { rating: "good", summary: null }, nextAction: { description: "Review role", due: "2026-07-13" } }),
      gig({ id: "different", availability: "unavailable", company: "Beta", stage: "applied", fit: { rating: "stretch", summary: null }, nextAction: { description: "Review role", due: "2026-07-20" } }),
      gig({ id: "available", availability: "available", company: "Acme", stage: "identified", fit: { rating: "good", summary: null }, nextAction: { description: "Review role", due: "2026-07-13" } }),
    ];
    const result = filterGigs(gigs, "unavailable", { search: "acme", stage: "identified", fit: "good", overdueOnly: true }, "2026-07-14");
    expect(result.map((item) => item.id)).toEqual(["matching"]);
  });

  test("sorts unavailable records by newest availability timestamp", () => {
    const newest = gig({ id: "newest", availability: "unavailable", availabilityUpdatedAt: "2026-07-15T16:00:00.000Z" });
    const older = gig({ id: "older", availability: "unavailable", availabilityUpdatedAt: "2026-07-14T16:00:00.000Z" });
    const missing = gig({ id: "missing", availability: "unavailable", availabilityUpdatedAt: null });
    expect([older, missing, newest].sort(compareUnavailableGigs).map(item => item.id)).toEqual(["newest", "older", "missing"]);
  });

  test("formats unavailable timestamps for Pacific presentation", () => {
    expect(formatUnavailableSince("2026-07-15T16:00:00.000Z")).toBe("Jul 15, 2026");
    expect(formatUnavailableSince(null)).toBeNull();
    expect(formatUnavailableSince(undefined)).toBeNull();
    expect(formatUnavailableSince("not-an-instant")).toBeNull();
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
