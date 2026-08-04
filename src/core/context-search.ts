import type { GigRecord } from "./gigs";
import type { PersonRecord } from "./people";
import type {
  GigQueryInput,
  PeopleQueryInput,
  Page,
} from "./queries";

export interface SearchContextInput {
  companyNames: string[];
  personNames: string[];
}

export interface SearchContextResult {
  gigs: Array<Pick<
    GigRecord,
    "id" | "company" | "title" | "stage" | "outcome"
  > & {
    matchedCompanyNames: string[];
  }>;
  people: Array<Pick<
    PersonRecord,
    "id" | "name" | "company" | "title" | "status"
  > & {
    matchedCompanyNames: string[];
    matchedPersonNames: string[];
  }>;
  truncated: boolean;
}

interface ContextSearchSources {
  gigs: { query(input: GigQueryInput): Page<GigRecord> };
  people: {
    query(input: PeopleQueryInput): Page<PersonRecord>;
  };
}

const normalized = (value: string) => value
  .normalize("NFKD")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, "");

const matches = (candidate: string | null, query: string) => {
  if (!candidate) return false;
  const normalizedCandidate = normalized(candidate);
  const normalizedQuery = normalized(query);
  return normalizedQuery.length > 0
    && (
      normalizedCandidate.includes(normalizedQuery)
      || normalizedQuery.includes(normalizedCandidate)
    );
};

const uniqueQueries = (queries: string[]) => [
  ...new Map(queries.map(query => [normalized(query), query.trim()] as const)).values(),
].filter(Boolean);

const searchTerms = (query: string) => [
  query.trim(),
  ...query
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(term => term.length >= 3),
].filter((term, index, values) => term && values.indexOf(term) === index);

export class SearchContextService {
  constructor(private readonly sources: ContextSearchSources) {}

  search(input: SearchContextInput): SearchContextResult {
    const companyNames = uniqueQueries(input.companyNames);
    const personNames = uniqueQueries(input.personNames);
    const gigCandidates = new Map<string, GigRecord>();
    const personCandidates = new Map<string, PersonRecord>();
    let truncated = false;

    for (const query of companyNames) {
      for (const term of searchTerms(query)) {
        const gigs = this.sources.gigs.query({ query: term, offset: 0, limit: 50 });
        truncated ||= gigs.page.hasMore;
        for (const gig of gigs.items) gigCandidates.set(gig.id, gig);

        const people = this.sources.people.query({
          query: term,
          offset: 0,
          limit: 50,
        });
        truncated ||= people.page.hasMore;
        for (const person of people.items) personCandidates.set(person.id, person);
      }
    }
    for (const query of personNames) {
      for (const term of searchTerms(query)) {
        const people = this.sources.people.query({
          query: term,
          offset: 0,
          limit: 50,
        });
        truncated ||= people.page.hasMore;
        for (const person of people.items) personCandidates.set(person.id, person);
      }
    }

    const allGigs = [...gigCandidates.values()].flatMap(gig => {
      const matchedCompanyNames = companyNames.filter(query => matches(gig.company, query));
      return matchedCompanyNames.length > 0 ? [{
        id: gig.id,
        company: gig.company,
        title: gig.title,
        stage: gig.stage,
        outcome: gig.outcome,
        matchedCompanyNames,
      }] : [];
    });
    const allPeople = [...personCandidates.values()].flatMap(person => {
      const matchedCompanyNames = companyNames.filter(query => matches(person.company, query));
      const matchedPersonNames = personNames.filter(query => matches(person.name, query));
      return matchedCompanyNames.length + matchedPersonNames.length > 0 ? [{
        id: person.id,
        name: person.name,
        company: person.company,
        title: person.title,
        status: person.status,
        matchedCompanyNames,
        matchedPersonNames,
      }] : [];
    });
    return {
      gigs: allGigs.slice(0, 20),
      people: allPeople.slice(0, 20),
      truncated: truncated || allGigs.length > 20 || allPeople.length > 20,
    };
  }
}
