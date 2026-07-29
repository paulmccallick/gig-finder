import { describe, expect, test } from "bun:test";
import type {
  ContactSummary,
  JobSummary,
  ListContactsInput,
  ListJobsInput,
} from "../src/agent-context";
import { SearchContextService } from "../src/context-search";

const job = (company: string, id = "job-1"): JobSummary => ({
  id,
  company,
  title: "Engineering Director",
  stage: "applied",
  outcome: "pending",
  statusSummary: "Applied",
  lastActivity: "2026-07-29",
  nextAction: null,
  fit: { rating: "good", summary: null },
  location: null,
  workArrangement: null,
});

const contact = (name: string, company: string): ContactSummary => ({
  id: "contact-1",
  name,
  company,
  title: "Recruiter",
  relationship: {
    type: "recruiter",
    strength: "warm",
    introducedBy: null,
    notes: null,
  },
  priority: "medium",
  status: "active_relationship",
  outreach: {
    lastContacted: null,
    lastContactMethod: null,
    lastContactSummary: null,
    nextAction: null,
    nextActionDue: null,
  },
  whyInteresting: null,
  updatedAt: "2026-07-29",
});

function existingSearches(jobs: JobSummary[], contacts: ContactSummary[]) {
  const calls = { jobs: [] as string[], contacts: [] as string[] };
  const page = <T>(items: T[]) => ({
    items,
    page: {
      offset: 0,
      limit: 50,
      returned: items.length,
      total: items.length,
      hasMore: false,
      nextOffset: null,
    },
  });
  const matches = (query: string | undefined, values: Array<string | null>) =>
    values.some(value => value?.toLocaleLowerCase().includes(query?.toLocaleLowerCase() ?? ""));
  return {
    calls,
    reader: {
      listJobs: (input: ListJobsInput) => {
        calls.jobs.push(input.query ?? "");
        return page(jobs.filter(item => matches(input.query, [item.company, item.title])));
      },
      listNetworkingContacts: (input: ListContactsInput) => {
        calls.contacts.push(input.query ?? "");
        return page(contacts.filter(item => matches(input.query, [item.name, item.company, item.title])));
      },
    },
  };
}

describe("context search", () => {
  test("composes existing searches and resolves punctuation variants", () => {
    const searches = existingSearches(
      [job("J.D. Power")],
      [contact("Kimberly Smith", "J.D. Power")],
    );
    const service = new SearchContextService(searches.reader);

    const result = service.search({
      companyNames: ["JD Power"],
      personNames: ["Kimberly"],
    });

    expect(searches.calls.jobs).toEqual(["JD Power", "Power"]);
    expect(searches.calls.contacts).toEqual(["JD Power", "Power", "Kimberly"]);
    expect(result.jobs).toEqual([expect.objectContaining({ id: "job-1" })]);
    expect(result.networkingContacts).toEqual([
      expect.objectContaining({ id: "contact-1" }),
    ]);
  });

  test("returns no records when existing searches find no relevant names", () => {
    const searches = existingSearches(
      [job("Example Company")],
      [contact("Alex Smith", "Example Company")],
    );
    const service = new SearchContextService(searches.reader);
    expect(service.search({ companyNames: ["Different"], personNames: [] }))
      .toMatchObject({ jobs: [], networkingContacts: [], truncated: false });
  });

  test("returns every plausible owner from existing search results", () => {
    const searches = existingSearches([
      job("Example Company"),
      { ...job("Example Company", "job-2"), title: "VP Engineering" },
    ], []);
    const service = new SearchContextService(searches.reader);
    expect(service.search({ companyNames: ["Example Company"], personNames: [] }).jobs)
      .toHaveLength(2);
  });
});
