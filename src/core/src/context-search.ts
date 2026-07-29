import type {
  AgentContextReader,
  ContactSummary,
  JobSummary,
} from "./agent-context";

export interface SearchContextInput {
  companyNames: string[];
  personNames: string[];
}

export interface SearchContextResult {
  jobs: Array<Pick<
    JobSummary,
    "id" | "company" | "title" | "stage" | "outcome"
  > & {
    matchedCompanyNames: string[];
  }>;
  networkingContacts: Array<Pick<
    ContactSummary,
    "id" | "name" | "company" | "title" | "status"
  > & {
    matchedCompanyNames: string[];
    matchedPersonNames: string[];
  }>;
  truncated: boolean;
}

type ContextSearchReader = Pick<
  AgentContextReader,
  "listJobs" | "listNetworkingContacts"
>;

const normalized = (value: string) => value
  .normalize("NFKD")
  .toLocaleLowerCase()
  .replace(/[^a-z0-9]+/g, "");

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
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter(term => term.length >= 3),
].filter((term, index, values) => term && values.indexOf(term) === index);

export class SearchContextService {
  constructor(private readonly reader: ContextSearchReader) {}

  search(input: SearchContextInput): SearchContextResult {
    const companyNames = uniqueQueries(input.companyNames);
    const personNames = uniqueQueries(input.personNames);
    const jobCandidates = new Map<string, JobSummary>();
    const contactCandidates = new Map<string, ContactSummary>();
    let truncated = false;

    for (const query of companyNames) {
      for (const term of searchTerms(query)) {
        const jobs = this.reader.listJobs({ query: term, offset: 0, limit: 50 });
        truncated ||= jobs.page.hasMore;
        for (const job of jobs.items) jobCandidates.set(job.id, job);

        const contacts = this.reader.listNetworkingContacts({
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
        const contacts = this.reader.listNetworkingContacts({
          query: term,
          offset: 0,
          limit: 50,
        });
        truncated ||= contacts.page.hasMore;
        for (const contact of contacts.items) contactCandidates.set(contact.id, contact);
      }
    }

    const allJobs = [...jobCandidates.values()].flatMap(job => {
      const matchedCompanyNames = companyNames.filter(query => matches(job.company, query));
      return matchedCompanyNames.length > 0 ? [{
        id: job.id,
        company: job.company,
        title: job.title,
        stage: job.stage,
        outcome: job.outcome,
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
      jobs: allJobs.slice(0, 20),
      networkingContacts: allContacts.slice(0, 20),
      truncated: truncated || allJobs.length > 20 || allContacts.length > 20,
    };
  }
}
