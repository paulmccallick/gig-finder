import {
  fitRatings,
  outcomes,
  pipelineStages,
  type FitRating,
  type Job,
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
  type NetworkContact,
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

export interface ListJobsInput extends PageInput {
  stages?: PipelineStage[];
  outcomes?: Outcome[];
  fitRatings?: FitRating[];
  excludeStages?: PipelineStage[];
  excludeOutcomes?: Outcome[];
  excludeFitRatings?: FitRating[];
  overdueOnly?: boolean;
  query?: string;
}

export interface ListContactsInput extends PageInput {
  statuses?: ContactStatus[];
  priorities?: ContactPriority[];
  relationshipStrengths?: RelationshipStrength[];
  excludeStatuses?: ContactStatus[];
  excludePriorities?: ContactPriority[];
  excludeRelationshipStrengths?: RelationshipStrength[];
  overdueOnly?: boolean;
  query?: string;
}

export interface ListTasksInput extends PageInput {
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  types?: TaskType[];
  excludeStatuses?: TaskStatus[];
  excludePriorities?: TaskPriority[];
  excludeTypes?: TaskType[];
  relatedEntityType?: TaskRecord["relatedEntity"]["type"];
  relatedEntityId?: string;
  overdueOnly?: boolean;
  query?: string;
}

export type JobSummary = Pick<
  Job,
  "id" | "company" | "title" | "stage" | "outcome" | "statusSummary"
  | "lastActivity" | "nextAction" | "fit" | "location" | "workArrangement"
>;
export type ContactSummary = Pick<
  NetworkContact,
  "id" | "name" | "company" | "title" | "relationship" | "priority" | "status"
  | "outreach" | "whyInteresting" | "updatedAt"
>;
export type TaskSummary = Omit<TaskRecord, "notes">;

export type GetResult<T> =
  | { status: "ok"; record: T }
  | { status: "not_found"; id: string };

export interface AgentContextReader {
  listJobs(input: ListJobsInput): Page<JobSummary>;
  getJob(id: string): GetResult<Job>;
  listNetworkingContacts(input: ListContactsInput): Page<ContactSummary>;
  getNetworkingContact(id: string): GetResult<NetworkContact>;
  listTasks(input: ListTasksInput): Page<TaskSummary>;
  getTask(id: string): GetResult<TaskRecord>;
}

export interface AgentContextSources {
  jobs: { list(): Job[]; get(id: string): Job | null };
  networking: { list(): NetworkContact[]; get(id: string): NetworkContact | null };
  tasks: { list(): TaskRecord[]; get(id: string): TaskRecord | null };
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

const jobSummary = (job: Job): JobSummary => ({
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
});

const contactSummary = (contact: NetworkContact): ContactSummary => ({
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
});

const taskSummary = ({ notes: _notes, ...task }: TaskRecord): TaskSummary => task;

export class JobSearchAgentContext implements AgentContextReader {
  constructor(
    private readonly sources: AgentContextSources,
    private readonly today: () => string = pacificDate,
  ) {}

  listJobs(input: ListJobsInput): Page<JobSummary> {
    const today = this.today();
    const stages = input.stages ?? [...defaultAgentJobStages];
    const query = normalizedQuery(input.query);
    const records = this.sources.jobs.list()
      .filter((job) => includes(stages, job.stage))
      .filter((job) => !includes(input.excludeStages ?? [], job.stage))
      .filter((job) => input.outcomes === undefined || (job.outcome !== null && includes(input.outcomes, job.outcome)))
      .filter((job) => job.outcome === null || !includes(input.excludeOutcomes ?? [], job.outcome))
      .filter((job) => input.fitRatings === undefined || includes(input.fitRatings, job.fit.rating))
      .filter((job) => !includes(input.excludeFitRatings ?? [], job.fit.rating))
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

  getJob(id: string): GetResult<Job> {
    const record = this.sources.jobs.get(id);
    return record ? { status: "ok", record } : { status: "not_found", id };
  }

  listNetworkingContacts(input: ListContactsInput): Page<ContactSummary> {
    const today = this.today();
    const statuses = input.statuses ?? [...defaultAgentContactStatuses];
    const query = normalizedQuery(input.query);
    const records = this.sources.networking.list()
      .filter((contact) => includes(statuses, contact.status))
      .filter((contact) => !includes(input.excludeStatuses ?? [], contact.status))
      .filter((contact) => input.priorities === undefined || includes(input.priorities, contact.priority))
      .filter((contact) => !includes(input.excludePriorities ?? [], contact.priority))
      .filter((contact) => input.relationshipStrengths === undefined || includes(input.relationshipStrengths, contact.relationship.strength))
      .filter((contact) => !includes(input.excludeRelationshipStrengths ?? [], contact.relationship.strength))
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

  getNetworkingContact(id: string): GetResult<NetworkContact> {
    const record = this.sources.networking.get(id);
    return record ? { status: "ok", record } : { status: "not_found", id };
  }

  listTasks(input: ListTasksInput): Page<TaskSummary> {
    const today = this.today();
    const statuses = input.statuses ?? [...defaultAgentTaskStatuses];
    const query = normalizedQuery(input.query);
    const records = this.sources.tasks.list()
      .filter((task) => includes(statuses, task.status))
      .filter((task) => !includes(input.excludeStatuses ?? [], task.status))
      .filter((task) => input.priorities === undefined || includes(input.priorities, task.priority))
      .filter((task) => !includes(input.excludePriorities ?? [], task.priority))
      .filter((task) => input.types === undefined || includes(input.types, task.type))
      .filter((task) => !includes(input.excludeTypes ?? [], task.type))
      .filter((task) => input.relatedEntityType === undefined || task.relatedEntity.type === input.relatedEntityType)
      .filter((task) => input.relatedEntityId === undefined || task.relatedEntity.id === input.relatedEntityId)
      .filter((task) => !input.overdueOnly || taskIsOverdue(task, today))
      .filter((task) => matchesQuery(query, [task.title, task.relatedEntity.label, task.notes]))
      .sort((a, b) => compareTasks(a, b, today) || a.id.localeCompare(b.id))
      .map(taskSummary);
    return page(records, input);
  }

  getTask(id: string): GetResult<TaskRecord> {
    const record = this.sources.tasks.get(id);
    return record ? { status: "ok", record } : { status: "not_found", id };
  }
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
