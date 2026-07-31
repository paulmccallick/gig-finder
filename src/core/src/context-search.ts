import type { GigRecord } from "./gigs";
import type { NetworkContactRecord } from "./network";
import type {
  GigQueryInput,
  NetworkingContactQueryInput,
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
  networkingContacts: Array<Pick<
    NetworkContactRecord,
    "id" | "name" | "company" | "title" | "status"
  > & {
    matchedCompanyNames: string[];
    matchedPersonNames: string[];
  }>;
  truncated: boolean;
}

interface ContextSearchSources {
  gigs: { query(input: GigQueryInput): Page<GigRecord> };
  networking: {
    query(input: NetworkingContactQueryInput): Page<NetworkContactRecord>;
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
    const contactCandidates = new Map<string, NetworkContactRecord>();
    let truncated = false;

    for (const query of companyNames) {
      for (const term of searchTerms(query)) {
        const gigs = this.sources.gigs.query({ query: term, offset: 0, limit: 50 });
        truncated ||= gigs.page.hasMore;
        for (const gig of gigs.items) gigCandidates.set(gig.id, gig);

        const contacts = this.sources.networking.query({
          query: term,
          offset: 0,
          limit: 50,
        });
        truncated ||= contacts.page.hasMore;
        for (const contact of contacts.items) contactCandidates.set(contact.id, contact);
      }
    }
    for (const query of personNames) {
      for (const term of searchTerms(query)) {
        const contacts = this.sources.networking.query({
          query: term,
          offset: 0,
          limit: 50,
        });
        truncated ||= contacts.page.hasMore;
        for (const contact of contacts.items) contactCandidates.set(contact.id, contact);
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
    const allContacts = [...contactCandidates.values()].flatMap(contact => {
      const matchedCompanyNames = companyNames.filter(query => matches(contact.company, query));
      const matchedPersonNames = personNames.filter(query => matches(contact.name, query));
      return matchedCompanyNames.length + matchedPersonNames.length > 0 ? [{
        id: contact.id,
        name: contact.name,
        company: contact.company,
        title: contact.title,
        status: contact.status,
        matchedCompanyNames,
        matchedPersonNames,
      }] : [];
    });
    return {
      gigs: allGigs.slice(0, 20),
      networkingContacts: allContacts.slice(0, 20),
      truncated: truncated || allGigs.length > 20 || allContacts.length > 20,
    };
  }
}
