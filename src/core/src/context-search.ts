import type { Job } from "./jobs";
import type { NetworkContact } from "./network";

export interface SearchContextInput {
  companyNames: string[];
  personNames: string[];
}

export interface SearchContextResult {
  jobs: Array<Pick<Job, "id" | "company" | "title" | "stage" | "outcome"> & {
    matchedCompanyNames: string[];
  }>;
  networkingContacts: Array<Pick<
    NetworkContact,
    "id" | "name" | "company" | "title" | "status"
  > & {
    matchedCompanyNames: string[];
    matchedPersonNames: string[];
  }>;
  truncated: boolean;
}

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

export class SearchContextService {
  constructor(private readonly sources: {
    jobs: { list(): Job[] };
    networking: { list(): NetworkContact[] };
  }) {}

  search(input: SearchContextInput): SearchContextResult {
    const companyNames = uniqueQueries(input.companyNames);
    const personNames = uniqueQueries(input.personNames);
    const allJobs = this.sources.jobs.list().flatMap(job => {
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
    const allContacts = this.sources.networking.list().flatMap(contact => {
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
      truncated: allJobs.length > 20 || allContacts.length > 20,
    };
  }
}
