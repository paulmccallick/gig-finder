import {
  fitRatings,
  outcomes,
  pipelineStages,
  type FitRating,
  type JobRecord,
  type Outcome,
  type PipelineStage,
} from "./jobs";
import {
  compareContacts,
  contactIsOverdue,
  contactPriorities,
  contactStatuses,
  relationshipStrengths,
  type ContactPriority,
  type ContactStatus,
  type NetworkContactRecord,
  type RelationshipStrength,
} from "./network";
import {
  compareTasks,
  taskIsOverdue,
  taskPriorities,
  taskStatuses,
  taskTypes,
  type TaskPriority,
  type TaskRecord,
  type TaskStatus,
  type TaskType,
} from "./tasks";
import type { ManagedDocumentService, ManagedDocumentType } from "./documents";

export const defaultAgentJobStages = [
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
] as const satisfies readonly PipelineStage[];
export const defaultAgentContactStatuses = [
  "active_relationship",
] as const satisfies readonly ContactStatus[];
export const defaultAgentTaskStatuses = [
  "open",
  "in_progress",
] as const satisfies readonly TaskStatus[];

export interface PageInput {
  offset?: number;
  limit?: number;
}

export interface PageMetadata {
  offset: number;
  limit: number;
  returned: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface Page<T> {
  items: T[];
  page: PageMetadata;
}

export type AgentDocumentType = ManagedDocumentType | "contact_profile";

interface AgentDocumentReferenceBase {
  reference: string;
  entityType: "job" | "contact";
  entityId: string;
  documentType: AgentDocumentType;
  title: string | null;
  displayName: string;
}

export type AgentDocumentReference = AgentDocumentReferenceBase & (
  | { storage: "artifact"; currentVersion: null }
  | { storage: "managed"; currentVersion: number }
);

export type AgentDocument = AgentDocumentReference & {
  content: string;
  truncated: boolean;
  totalCharacters: number;
};

export const agentDocumentContentLimit = 50_000;

export interface ListJobsInput extends PageInput {
  stages?: PipelineStage[];
  outcomes?: Outcome[];
  fitRatings?: FitRating[];
  overdueOnly?: boolean;
  query?: string;
}

export interface ListContactsInput extends PageInput {
  statuses?: ContactStatus[];
  priorities?: ContactPriority[];
  relationshipStrengths?: RelationshipStrength[];
  overdueOnly?: boolean;
  query?: string;
}

export interface ListTasksInput extends PageInput {
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  types?: TaskType[];
  relatedEntityType?: TaskRecord["relatedEntity"]["type"];
  relatedEntityId?: string;
  overdueOnly?: boolean;
  query?: string;
}

export type JobSummary = Pick<
  JobRecord,
  "id" | "company" | "title" | "stage" | "outcome" | "statusSummary"
  | "lastActivity" | "nextAction" | "fit" | "location" | "workArrangement"
  | "documents"
>;
export type ContactSummary = Pick<
  NetworkContactRecord,
  "id" | "name" | "company" | "title" | "relationship" | "priority" | "status"
  | "outreach" | "whyInteresting" | "updatedAt" | "personId" | "hasProfile"
  | "documents"
>;
export type TaskSummary = TaskRecord;
export type JobDetail = Pick<
  JobRecord,
  "id" | "company" | "title" | "jobId" | "stage" | "outcome"
  | "statusSummary" | "lastActivity" | "nextAction" | "fit" | "payRange"
  | "sourceUrl" | "tags" | "hasJobDescription" | "hasInterviewPrep"
  | "location" | "workArrangement" | "postedDate" | "businessUnitTeam"
  | "recruiterSource" | "bonus" | "equity" | "otherCompensation" | "documents"
> & { legacyDocuments: AgentDocumentReference[] };
export type ContactDetail = Pick<
  NetworkContactRecord,
  "id" | "name" | "company" | "title" | "linkedInProfileUrl"
  | "profileStatus" | "hasProfile" | "personId" | "connectedOn" | "relationship"
  | "priority" | "status" | "outreach" | "whyInteresting" | "notes" | "tags"
  | "createdAt" | "updatedAt" | "documents"
> & { legacyDocuments: AgentDocumentReference[] };
export type TaskDetail = Pick<
  TaskRecord,
  "id" | "title" | "type" | "status" | "priority" | "dueDate"
  | "relatedEntity" | "notes" | "createdAt" | "updatedAt" | "completedAt"
> & {
  documents: AgentDocumentReference[];
};

export type GetResult<T> =
  | { status: "ok"; record: T }
  | { status: "not_found"; id: string };

export interface AgentContextReader {
  listJobs(input: ListJobsInput): Page<JobSummary>;
  getJob(id: string): Promise<GetResult<JobDetail>>;
  listNetworkingContacts(input: ListContactsInput): Page<ContactSummary>;
  getNetworkingContact(id: string): Promise<GetResult<ContactDetail>>;
  listTasks(input: ListTasksInput): Page<TaskSummary>;
  getTask(id: string): Promise<GetResult<TaskDetail>>;
  getDocument(reference: string): Promise<GetResult<AgentDocument>>;
}

export interface AgentContextSources {
  jobs: { list(): JobRecord[]; get(id: string): JobRecord | null };
  networking: { list(): NetworkContactRecord[]; get(id: string): NetworkContactRecord | null };
  tasks: { list(): TaskRecord[]; get(id: string): TaskRecord | null };
  documents?: AgentDocumentSource;
}

export interface AgentDocumentSource {
  list(entityType: "job" | "contact", entityId: string): Promise<AgentDocumentReference[]>;
  get(reference: string): Promise<GetResult<AgentDocument>>;
}

const includes = <T>(values: readonly T[], value: T) => values.includes(value);
const normalizedQuery = (query?: string) => query?.trim().toLocaleLowerCase() ?? "";
const matchesQuery = (query: string, values: Array<string | null | undefined>) =>
  !query || values.some((value) => value?.toLocaleLowerCase().includes(query));

function pacificDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function page<T>(items: T[], input: PageInput): Page<T> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  const selected = items.slice(offset, offset + limit);
  const hasMore = offset + selected.length < items.length;
  return {
    items: selected,
    page: {
      offset,
      limit,
      returned: selected.length,
      total: items.length,
      hasMore,
      nextOffset: hasMore ? offset + selected.length : null,
    },
  };
}

const jobSummary = (job: JobRecord): JobSummary => ({
  id: job.id,
  company: job.company,
  title: job.title,
  stage: job.stage,
  outcome: job.outcome,
  statusSummary: job.statusSummary,
  lastActivity: job.lastActivity,
  nextAction: job.nextAction,
  fit: job.fit,
  location: job.location,
  workArrangement: job.workArrangement,
  documents: job.documents,
});

const contactSummary = (contact: NetworkContactRecord): ContactSummary => ({
  id: contact.id,
  name: contact.name,
  company: contact.company,
  title: contact.title,
  relationship: contact.relationship,
  priority: contact.priority,
  status: contact.status,
  outreach: contact.outreach,
  whyInteresting: contact.whyInteresting,
  updatedAt: contact.updatedAt,
  personId: contact.personId,
  hasProfile: contact.hasProfile,
  documents: contact.documents,
});

const taskSummary = (task: TaskRecord): TaskSummary => task;

const noDocuments: AgentDocumentSource = {
  list: async () => [],
  get: async (reference) => ({ status: "not_found", id: reference }),
};

const hasMeaningfulFilters = (
  input: Record<string, unknown>,
  ignored: readonly string[],
) => Object.entries(input).some(([key, value]) =>
  !ignored.includes(key) && value !== undefined && value !== false && value !== ""
);

const jobDetail = (
  job: JobRecord,
  legacyDocuments: AgentDocumentReference[],
): JobDetail => ({
  id: job.id,
  company: job.company,
  title: job.title,
  jobId: job.jobId,
  stage: job.stage,
  outcome: job.outcome,
  statusSummary: job.statusSummary,
  lastActivity: job.lastActivity,
  nextAction: job.nextAction,
  fit: job.fit,
  payRange: job.payRange,
  sourceUrl: job.sourceUrl,
  tags: job.tags,
  hasJobDescription: job.hasJobDescription,
  hasInterviewPrep: job.hasInterviewPrep,
  location: job.location,
  workArrangement: job.workArrangement,
  postedDate: job.postedDate,
  businessUnitTeam: job.businessUnitTeam,
  recruiterSource: job.recruiterSource,
  bonus: job.bonus,
  equity: job.equity,
  otherCompensation: job.otherCompensation,
  documents: job.documents,
  legacyDocuments,
});

const contactDetail = (
  contact: NetworkContactRecord,
  legacyDocuments: AgentDocumentReference[],
): ContactDetail => ({
  id: contact.id,
  name: contact.name,
  company: contact.company,
  title: contact.title,
  linkedInProfileUrl: contact.linkedInProfileUrl,
  profileStatus: contact.profileStatus,
  hasProfile: contact.hasProfile,
  personId: contact.personId,
  connectedOn: contact.connectedOn,
  relationship: contact.relationship,
  priority: contact.priority,
  status: contact.status,
  outreach: contact.outreach,
  whyInteresting: contact.whyInteresting,
  notes: contact.notes,
  tags: contact.tags,
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt,
  documents: contact.documents,
  legacyDocuments,
});

const taskDetail = (task: TaskRecord): TaskDetail => ({
  id: task.id,
  title: task.title,
  type: task.type,
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate,
  relatedEntity: task.relatedEntity,
  notes: task.notes,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  completedAt: task.completedAt,
  documents: [],
});

export class JobSearchAgentContext implements AgentContextReader {
  constructor(
    private readonly sources: AgentContextSources,
    private readonly today: () => string = pacificDate,
  ) {}

  listJobs(input: ListJobsInput): Page<JobSummary> {
    const today = this.today();
    const hasFilters = hasMeaningfulFilters(input as Record<string, unknown>, ["offset", "limit"]);
    const stages = input.stages ?? (hasFilters ? [...pipelineStages] : [...defaultAgentJobStages]);
    const query = normalizedQuery(input.query);
    const records = this.sources.jobs.list()
      .filter((job) => includes(stages, job.stage))
      .filter((job) => input.outcomes === undefined || includes(input.outcomes, job.outcome))
      .filter((job) => input.fitRatings === undefined || includes(input.fitRatings, job.fit.rating))
      .filter((job) => !input.overdueOnly || Boolean(job.nextAction?.due && job.nextAction.due < today))
      .filter((job) => matchesQuery(query, [
        job.company,
        job.title,
        job.statusSummary,
        job.nextAction?.description,
      ]))
      .sort((a, b) => {
        const overdue = Number(Boolean(b.nextAction?.due && b.nextAction.due < today))
          - Number(Boolean(a.nextAction?.due && a.nextAction.due < today));
        return overdue
          || (a.nextAction?.due ?? "9999-12-31").localeCompare(b.nextAction?.due ?? "9999-12-31")
          || b.lastActivity.localeCompare(a.lastActivity)
          || a.company.localeCompare(b.company)
          || a.id.localeCompare(b.id);
      })
      .map(jobSummary);
    return page(records, input);
  }

  async getJob(id: string): Promise<GetResult<JobDetail>> {
    const record = this.sources.jobs.get(id);
    if (!record) return { status: "not_found", id };
    return {
      status: "ok",
      record: jobDetail(
        record,
        (await (this.sources.documents ?? noDocuments).list("job", id))
          .filter(document => document.storage === "artifact"),
      ),
    };
  }

  listNetworkingContacts(input: ListContactsInput): Page<ContactSummary> {
    const today = this.today();
    const hasFilters = hasMeaningfulFilters(input as Record<string, unknown>, ["offset", "limit"]);
    const statuses = input.statuses ?? (hasFilters ? [...contactStatuses] : [...defaultAgentContactStatuses]);
    const query = normalizedQuery(input.query);
    const records = this.sources.networking.list()
      .filter((contact) => includes(statuses, contact.status))
      .filter((contact) => input.priorities === undefined || includes(input.priorities, contact.priority))
      .filter((contact) => input.relationshipStrengths === undefined || includes(input.relationshipStrengths, contact.relationship.strength))
      .filter((contact) => !input.overdueOnly || contactIsOverdue(contact, today))
      .filter((contact) => matchesQuery(query, [
        contact.name,
        contact.company,
        contact.title,
        contact.whyInteresting,
      ]))
      .sort((a, b) => compareContacts(a, b, today) || a.id.localeCompare(b.id))
      .map(contactSummary);
    return page(records, input);
  }

  async getNetworkingContact(id: string): Promise<GetResult<ContactDetail>> {
    const record = this.sources.networking.get(id);
    if (!record) return { status: "not_found", id };
    return {
      status: "ok",
      record: contactDetail(
        record,
        (await (this.sources.documents ?? noDocuments).list("contact", id))
          .filter(document => document.storage === "artifact"),
      ),
    };
  }

  listTasks(input: ListTasksInput): Page<TaskSummary> {
    const today = this.today();
    const hasFilters = hasMeaningfulFilters(input as Record<string, unknown>, ["offset", "limit"]);
    const statuses = input.statuses ?? (hasFilters ? [...taskStatuses] : [...defaultAgentTaskStatuses]);
    const query = normalizedQuery(input.query);
    const records = this.sources.tasks.list()
      .filter((task) => includes(statuses, task.status))
      .filter((task) => input.priorities === undefined || includes(input.priorities, task.priority))
      .filter((task) => input.types === undefined || includes(input.types, task.type))
      .filter((task) => input.relatedEntityType === undefined || task.relatedEntity.type === input.relatedEntityType)
      .filter((task) => input.relatedEntityId === undefined || task.relatedEntity.id === input.relatedEntityId)
      .filter((task) => !input.overdueOnly || taskIsOverdue(task, today))
      .filter((task) => matchesQuery(query, [task.title, task.relatedEntity.label, task.notes]))
      .sort((a, b) => compareTasks(a, b, today) || a.id.localeCompare(b.id))
      .map(taskSummary);
    return page(records, input);
  }

  async getTask(id: string): Promise<GetResult<TaskDetail>> {
    const record = this.sources.tasks.get(id);
    return record
      ? { status: "ok", record: taskDetail(record) }
      : { status: "not_found", id };
  }

  getDocument(reference: string): Promise<GetResult<AgentDocument>> {
    return (this.sources.documents ?? noDocuments).get(reference);
  }
}

const encoded = (value: string) => encodeURIComponent(value);
const decoded = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

export interface AgentDocumentServices {
  jobs: {
    get(id: string): JobRecord | null;
    description(id: string): Promise<string | null>;
    prep(id: string): Promise<Array<{ name: string; content: string }>>;
  };
  contacts: {
    personId(id: string): string | null;
  };
  managed?: Pick<ManagedDocumentService, "get" | "list">;
}

export class ApplicationAgentDocumentSource implements AgentDocumentSource {
  constructor(private readonly services: AgentDocumentServices) {}

  private personId(contactId: string) {
    return this.services.contacts.personId(contactId);
  }

  async list(
    entityType: "job" | "contact",
    entityId: string,
  ): Promise<AgentDocumentReference[]> {
    if (entityType === "contact") {
      const personId = this.personId(entityId);
      const references: AgentDocumentReference[] = [];
      for (const document of personId
        ? this.services.managed?.list("person", personId) ?? []
        : []) {
        references.push({
          reference: document.id,
          entityType,
          entityId,
          documentType: document.documentType,
          title: document.title,
          displayName: document.displayName,
          storage: "managed",
          currentVersion: document.currentVersion,
        });
      }
      return references;
    }
    const job = this.services.jobs.get(entityId);
    if (!job) return [];
    const references: AgentDocumentReference[] = [];
    if (job.hasJobDescription) {
      references.push({
        reference: `job:${encoded(entityId)}:job_description`,
        entityType,
        entityId,
        documentType: "job_description",
        title: "Job description",
        displayName: "Job Description",
        storage: "artifact",
        currentVersion: null,
      });
    }
    if (job.hasInterviewPrep) {
      for (const document of await this.services.jobs.prep(entityId)) {
        references.push({
          reference: `job:${encoded(entityId)}:interview_prep:${encoded(document.name)}`,
          entityType,
          entityId,
          documentType: "interview_prep",
          title: document.name,
          displayName: document.name,
          storage: "artifact",
          currentVersion: null,
        });
      }
    }
    for (const document of this.services.managed?.list("job", entityId) ?? []) {
      references.push({
        reference: document.id,
        entityType: "job",
        entityId,
        documentType: document.documentType,
        title: document.title,
        displayName: document.displayName,
        storage: "managed",
        currentVersion: document.currentVersion,
      });
    }
    return references;
  }

  async get(reference: string): Promise<GetResult<AgentDocument>> {
    if (reference.startsWith("doc_") || reference.startsWith("document:")) {
      const managed = this.services.managed?.get(reference) ?? null;
      const primaryLink = managed?.links[0];
      return managed && primaryLink
        ? {
            status: "ok",
            record: documentRecord({
              reference: managed.id,
              entityType: primaryLink.entityType === "job" ? "job" : "contact",
              entityId: primaryLink.entityId,
              documentType: managed.documentType,
              title: managed.title,
              displayName: managed.displayName,
              storage: "managed",
              currentVersion: managed.currentVersion,
            }, managed.content),
          }
        : { status: "not_found", id: reference };
    }
    const parts = reference.split(":");
    const entityType = parts[0];
    const entityId = parts[1] ? decoded(parts[1]) : null;
    const documentType = parts[2];
    if (!entityId || (entityType !== "job" && entityType !== "contact")) {
      return { status: "not_found", id: reference };
    }
    const available = await this.list(entityType, entityId);
    const match = available.find((item) => item.reference === reference);
    if (!match) return { status: "not_found", id: reference };
    if (documentType === "job_description") {
      const content = await this.services.jobs.description(entityId);
      return content !== null
        ? { status: "ok", record: documentRecord(match, content) }
        : { status: "not_found", id: reference };
    }
    const title = parts[3] ? decoded(parts[3]) : null;
    const document = title
      ? (await this.services.jobs.prep(entityId)).find((item) => item.name === title)
      : null;
    return document
      ? { status: "ok", record: documentRecord(match, document.content) }
      : { status: "not_found", id: reference };
  }
}

function documentRecord(
  reference: AgentDocumentReference,
  content: string,
): AgentDocument {
  return {
    ...reference,
    content: content.slice(0, agentDocumentContentLimit),
    truncated: content.length > agentDocumentContentLimit,
    totalCharacters: content.length,
  };
}

export const agentContextEnums = {
  pipelineStages,
  outcomes,
  fitRatings,
  contactStatuses,
  contactPriorities,
  relationshipStrengths,
  taskStatuses,
  taskPriorities,
  taskTypes,
} as const;
