import { describe, expect, test } from "bun:test";
import type { GigRecord } from "../gigs";
import type { PersonRecord } from "../people";
import type { GigQueryInput, PeopleQueryInput } from "../queries";
import { SearchContextService } from "../context-search";

const gig = (company: string, id = "gig-1"): GigRecord => ({
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
  documents: [],
  externalJobId: null,
  artifactDirectory: null,
  payRange: null,
  sourceUrl: null,
  tags: [],
  hasJobDescription: false,
  hasInterviewPrep: false,
  postedDate: null,
  businessUnitTeam: null,
  recruiterSource: null,
  bonus: null,
  equity: null,
  otherCompensation: null,
});

const person = (name: string, company: string): PersonRecord => ({
  id: "person-1",
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
  hasProfile: false,
  documents: [],
  linkedInProfileUrl: null,
  profileStatus: "missing",
  connectedOn: null,
  notes: [],
  tags: [],
  createdAt: "2026-07-29",
});

function existingSearches(gigs: GigRecord[], people: PersonRecord[]) {
  const calls = { gigs: [] as string[], people: [] as string[] };
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
    sources: {
      gigs: { query: (input: GigQueryInput) => {
        calls.gigs.push(input.query ?? "");
        return page(gigs.filter(item => matches(input.query, [item.company, item.title])));
      } },
      people: { query: (input: PeopleQueryInput) => {
        calls.people.push(input.query ?? "");
        return page(people.filter(item => matches(input.query, [item.name, item.company, item.title])));
      } },
    },
  };
}

describe("context search", () => {
  test("composes existing searches and resolves punctuation variants", () => {
    const searches = existingSearches(
      [gig("J.D. Example")],
      [person("Taylor Smith", "J.D. Example")],
    );
    const service = new SearchContextService(searches.sources);

    const result = service.search({
      companyNames: ["JD Example"],
      personNames: ["Taylor"],
    });

    expect(searches.calls.gigs).toEqual(["JD Example", "Example"]);
    expect(searches.calls.people).toEqual(["JD Example", "Example", "Taylor"]);
    expect(result.gigs).toEqual([expect.objectContaining({ id: "gig-1" })]);
    expect(result.people).toEqual([
      expect.objectContaining({ id: "person-1" }),
    ]);
  });

  test("returns no records when existing searches find no relevant names", () => {
    const searches = existingSearches(
      [gig("Example Company")],
      [person("Alex Smith", "Example Company")],
    );
    const service = new SearchContextService(searches.sources);
    expect(service.search({ companyNames: ["Different"], personNames: [] }))
      .toMatchObject({ gigs: [], people: [], truncated: false });
  });

  test("returns every plausible owner from existing search results", () => {
    const searches = existingSearches([
      gig("Example Company"),
      { ...gig("Example Company", "gig-2"), title: "VP Engineering" },
    ], []);
    const service = new SearchContextService(searches.sources);
    expect(service.search({ companyNames: ["Example Company"], personNames: [] }).gigs)
      .toHaveLength(2);
  });

  test("preserves non-Latin company and person names", () => {
    const searches = existingSearches(
      [gig("株式会社サンプル")],
      [person("李雷", "株式会社サンプル")],
    );
    const service = new SearchContextService(searches.sources);

    expect(service.search({
      companyNames: ["株式会社サンプル"],
      personNames: ["李雷"],
    })).toMatchObject({
      gigs: [expect.objectContaining({ id: "gig-1" })],
      people: [expect.objectContaining({ id: "person-1" })],
    });
  });
});
