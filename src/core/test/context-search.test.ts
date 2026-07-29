import { describe, expect, test } from "bun:test";
import { SearchContextService } from "../src/context-search";
import type { Job } from "../src/jobs";
import type { NetworkContact } from "../src/network";

const job = (company: string): Job => ({
  id: "job-1", company, title: "Engineering Director", jobId: null,
  roleDirectory: null, stage: "applied", outcome: "pending",
  statusSummary: "Applied", lastActivity: "2026-07-29", nextAction: null,
  fit: { rating: "good", summary: null }, payRange: null, sourceUrl: null,
  tags: [], hasJobDescription: false, hasInterviewPrep: false, location: null,
  workArrangement: null, postedDate: null, businessUnitTeam: null,
  recruiterSource: null, bonus: null, equity: null, otherCompensation: null,
});

const contact = (name: string, company: string): NetworkContact => ({
  id: "contact-1", name, company, title: "Recruiter", linkedInProfileUrl: null,
  profileStatus: "missing", connectedOn: null,
  relationship: { type: "recruiter", strength: "warm", introducedBy: null, notes: null },
  priority: "medium", status: "active_relationship",
  outreach: { lastContacted: null, lastContactMethod: null, lastContactSummary: null, nextAction: null, nextActionDue: null },
  whyInteresting: null, notes: [], tags: [], source: { files: [] },
  createdAt: "2026-07-29", updatedAt: "2026-07-29",
});

describe("context search", () => {
  test("resolves punctuation variants across jobs and contacts", () => {
    const service = new SearchContextService({
      jobs: { list: () => [job("J.D. Power")] },
      networking: { list: () => [contact("Kimberly Smith", "J.D. Power")] },
    });

    const result = service.search({
      companyNames: ["JD Power"],
      personNames: ["Kimberly"],
    });

    expect(result.jobs).toEqual([expect.objectContaining({ id: "job-1" })]);
    expect(result.networkingContacts).toEqual([
      expect.objectContaining({ id: "contact-1" }),
    ]);
  });

  test("returns no records when neither company nor person matches", () => {
    const service = new SearchContextService({
      jobs: { list: () => [job("Example Company")] },
      networking: { list: () => [contact("Alex Smith", "Example Company")] },
    });
    expect(service.search({ companyNames: ["Different"], personNames: [] }))
      .toMatchObject({ jobs: [], networkingContacts: [], truncated: false });
  });

  test("returns every plausible owner so the caller can resolve ambiguity", () => {
    const secondJob = { ...job("Example Company"), id: "job-2", title: "VP Engineering" };
    const service = new SearchContextService({
      jobs: { list: () => [job("Example Company"), secondJob] },
      networking: { list: () => [] },
    });
    expect(service.search({ companyNames: ["Example Company"], personNames: [] }).jobs)
      .toHaveLength(2);
  });
});
