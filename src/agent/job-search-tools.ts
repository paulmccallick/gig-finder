import { tool } from "ai";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  AgentContextReader,
  ChangeService,
  ContactDomainService,
  JobDomainService,
  JobUpdate,
  ListContactsInput,
  ListJobsInput,
  ListTasksInput,
  ManagedDocumentMutationResult,
  ManagedDocumentService,
  NetworkingContactUpdate,
} from "../core/src";
import { DomainValidationError, MutationError } from "../core/src/errors";
import {
  jobUpdateSchema,
  networkingContactUpdateSchema,
} from "../core/src/update-contracts";
import { fitRatings, outcomes, pipelineStages } from "../core/src/jobs";
import {
  contactPriorities,
  contactStatuses,
  relationshipStrengths,
} from "../core/src/network";
import { taskPriorities, taskStatuses, taskTypes } from "../core/src/tasks";
import {
  documentMediaTypes,
  documentOwnerTypes,
  managedDocumentContentLimit,
  managedDocumentTypes,
} from "../core/src/documents";
import {
  contactChangesSchema,
  jobChangesSchema,
} from "./update-tool-schemas";

const nonEmptyArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).min(1);

const pageSchema = {
  offset: z.number().int().min(0).nullable()
    .describe("Zero-based number of matching records to skip. Uses 0 when not specified."),
  limit: z.number().int().min(1).max(50).nullable()
    .describe("Maximum number of records to return, from 1 to 50. Uses 20 when not specified."),
};

const listJobsInputSchema = z.object({
  stages: nonEmptyArray(pipelineStages).nullable()
    .describe("Include jobs in any of these pipeline stages."),
  outcomes: nonEmptyArray(outcomes).nullable()
    .describe("Include jobs with any of these outcomes."),
  fitRatings: nonEmptyArray(fitRatings).nullable()
    .describe("Include jobs with any of these candidate fit ratings."),
  overdueOnly: z.boolean().nullable()
    .describe("When true, include only jobs whose next action is overdue."),
  query: z.string().trim().nullable()
    .describe("Case-insensitive text to search across job summary fields."),
  ...pageSchema,
}).strict();

const listContactsInputSchema = z.object({
  statuses: nonEmptyArray(contactStatuses).nullable()
    .describe("Include contacts with any of these networking statuses."),
  priorities: nonEmptyArray(contactPriorities).nullable()
    .describe("Include contacts with any of these networking priorities."),
  relationshipStrengths: nonEmptyArray(relationshipStrengths).nullable()
    .describe("Include contacts with any of these relationship strengths."),
  overdueOnly: z.boolean().nullable()
    .describe("When true, include only contacts whose next outreach is overdue."),
  query: z.string().trim().nullable()
    .describe("Case-insensitive text to search across contact summary fields."),
  ...pageSchema,
}).strict();

const listTasksInputSchema = z.object({
  statuses: nonEmptyArray(taskStatuses).nullable()
    .describe("Include tasks with any of these statuses."),
  priorities: nonEmptyArray(taskPriorities).nullable()
    .describe("Include tasks with any of these priorities."),
  types: nonEmptyArray(taskTypes).nullable()
    .describe("Include tasks with any of these task types."),
  relatedEntityType: z.enum(["job", "contact", "general"]).nullable()
    .describe("Include tasks related to this kind of entity."),
  relatedEntityId: z.string().trim().min(1).nullable()
    .describe("Include tasks related to this exact durable job or contact ID."),
  overdueOnly: z.boolean().nullable()
    .describe("When true, include only tasks whose due date is overdue."),
  query: z.string().trim().nullable()
    .describe("Case-insensitive text to search across task summary fields."),
  ...pageSchema,
}).strict();

const getInputSchema = z.object({
  id: z.string().trim().min(1)
    .describe("Exact durable record ID returned by the corresponding list tool."),
}).strict();

const getDocumentInputSchema = z.object({
  reference: z.string().trim().min(1)
    .describe("Exact registered document reference returned by a detail tool."),
}).strict();

const updateJobInputSchema = z.object({
  id: getInputSchema.shape.id,
  changes: jobChangesSchema
    .describe("One or more explicit changes to mutable job fields."),
}).strict();

const updateNetworkingContactInputSchema = z.object({
  id: getInputSchema.shape.id,
  changes: contactChangesSchema
    .describe("One or more explicit changes to mutable networking-contact fields."),
}).strict();

const revertChangeInputSchema = z.object({
  changeId: z.string().trim().min(1)
    .describe("Exact change ID of the update to revert."),
}).strict();

const createDocumentInputSchema = z.object({
  ownerType: z.enum(documentOwnerTypes)
    .describe("Type of existing record that will own the document."),
  ownerId: z.string().trim().min(1)
    .describe("Exact durable owner ID returned by a corresponding list tool."),
  documentType: z.enum(managedDocumentTypes)
    .describe("Document category. Use job_description for supplied source text, notes for working notes, or interview_prep for preparation material."),
  title: z.string().trim().min(1).max(200)
    .describe("Concise human-readable document title."),
  mediaType: z.enum(documentMediaTypes)
    .describe("Text format: text/plain or text/markdown."),
  sourceDescription: z.string().trim().min(1).max(500).nullable()
    .describe("How the content was obtained, without inventing details; use null when unknown or not applicable."),
  content: z.string().min(1).max(managedDocumentContentLimit)
    .describe(`Complete document content, up to ${managedDocumentContentLimit} characters.`),
}).strict();

const updateDocumentInputSchema = z.object({
  reference: getDocumentInputSchema.shape.reference,
  expectedVersion: z.number().int().positive()
    .describe("Current managed-document version returned by create_document, get_job, or get_document."),
  content: z.string().min(1).max(managedDocumentContentLimit)
    .describe(`Complete replacement content, up to ${managedDocumentContentLimit} characters.`),
  changeSummary: z.string().trim().min(1).max(500)
    .describe("Concise factual description of what changed."),
}).strict();

type ToolInput = {
  [key: string]: unknown;
  offset?: number | null;
  limit?: number | null;
  relatedEntityId?: string | null;
  id?: string;
  reference?: string;
  query?: string | null;
  changeId?: string;
  changes?: Array<{ field: string }>;
  ownerId?: string;
  ownerType?: string;
  documentType?: string;
  expectedVersion?: number;
};

export interface ToolFailure {
  status: "error";
  error:
    | "duplicate_change"
    | "not_found"
    | "not_revertible"
    | "revision_conflict"
    | "validation_failed"
    | "tool_failed";
  message: string;
}

export interface JobSearchMutationCapabilities {
  jobs: Pick<JobDomainService, "update">;
  networking: Pick<ContactDomainService, "update">;
  changes: Pick<ChangeService, "revert">;
  documents: Pick<ManagedDocumentService, "create" | "update">;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toolInvocationDetails(input: ToolInput) {
  const appliedFilters = Object.fromEntries(
    Object.entries(input)
      .filter(([key]) =>
        ![
          "id", "reference", "query", "offset", "limit", "relatedEntityId",
          "changes", "changeId", "ownerId", "ownerType", "documentType",
          "expectedVersion", "title", "mediaType", "sourceDescription", "content",
          "changeSummary",
        ].includes(key)
      )
      .filter(([, value]) =>
        value !== undefined
        && value !== null
        && value !== false
        && (!Array.isArray(value) || value.length > 0)
      ),
  );
  const queryApplied = typeof input.query === "string" && input.query.length > 0;
  const relatedEntityFilter = typeof input.relatedEntityId === "string"
    ? { relatedEntityId: input.relatedEntityId }
    : {};
  const filters = {
    ...appliedFilters,
    ...relatedEntityFilter,
    ...(queryApplied
      ? { query: { present: true, characters: input.query?.length } }
      : {}),
  };

  return {
    ...(input.id === undefined ? {} : { recordId: input.id }),
    ...(input.reference === undefined ? {} : { documentReference: input.reference }),
    ...(input.ownerId === undefined
      ? {}
      : { documentOwner: { type: input.ownerType, id: input.ownerId } }),
    ...(input.documentType === undefined
      ? {}
      : { documentType: input.documentType }),
    ...(input.expectedVersion === undefined
      ? {}
      : { expectedVersion: input.expectedVersion }),
    ...(input.changeId === undefined ? {} : { changeId: input.changeId }),
    ...(input.changes === undefined
      ? {}
      : { updateFields: input.changes.map(change => change.field) }),
    filterMode: Object.keys(filters).length === 0 ? "unfiltered" : "filtered",
    appliedFilters: filters,
    ...(
      input.offset === undefined && input.limit === undefined
        ? {}
        : {
            pagination: {
              offset: input.offset ?? 0,
              limit: input.limit ?? 20,
            },
          }
    ),
  };
}

function changesToPatch(
  changes: ReadonlyArray<{ field: string; value: string | number | string[] | null }>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const { field, value } of changes) {
    const separator = field.indexOf(".");
    if (separator === -1) {
      patch[field] = value;
      continue;
    }
    const parent = field.slice(0, separator);
    const child = field.slice(separator + 1);
    const nested = isRecord(patch[parent]) ? patch[parent] : {};
    patch[parent] = { ...nested, [child]: value };
  }
  return patch;
}

function jobPatchFromOperations(
  changes: z.infer<typeof jobChangesSchema>,
): JobUpdate {
  return jobUpdateSchema.parse(changesToPatch(changes));
}

function contactPatchFromOperations(
  changes: z.infer<typeof contactChangesSchema>,
): NetworkingContactUpdate {
  return networkingContactUpdateSchema.parse(changesToPatch(changes));
}

function normalizeJobsInput(
  input: z.infer<typeof listJobsInputSchema>,
): ListJobsInput {
  return {
    ...(input.stages === null ? {} : { stages: input.stages }),
    ...(input.outcomes === null ? {} : { outcomes: input.outcomes }),
    ...(input.fitRatings === null ? {} : { fitRatings: input.fitRatings }),
    ...(input.overdueOnly === null ? {} : { overdueOnly: input.overdueOnly }),
    ...(input.query === null ? {} : { query: input.query }),
    ...(input.offset === null ? {} : { offset: input.offset }),
    ...(input.limit === null ? {} : { limit: input.limit }),
  };
}

function normalizeContactsInput(
  input: z.infer<typeof listContactsInputSchema>,
): ListContactsInput {
  return {
    ...(input.statuses === null ? {} : { statuses: input.statuses }),
    ...(input.priorities === null ? {} : { priorities: input.priorities }),
    ...(input.relationshipStrengths === null
      ? {}
      : { relationshipStrengths: input.relationshipStrengths }),
    ...(input.overdueOnly === null ? {} : { overdueOnly: input.overdueOnly }),
    ...(input.query === null ? {} : { query: input.query }),
    ...(input.offset === null ? {} : { offset: input.offset }),
    ...(input.limit === null ? {} : { limit: input.limit }),
  };
}

function normalizeTasksInput(
  input: z.infer<typeof listTasksInputSchema>,
): ListTasksInput {
  return {
    ...(input.statuses === null ? {} : { statuses: input.statuses }),
    ...(input.priorities === null ? {} : { priorities: input.priorities }),
    ...(input.types === null ? {} : { types: input.types }),
    ...(input.relatedEntityType === null
      ? {}
      : { relatedEntityType: input.relatedEntityType }),
    ...(input.relatedEntityId === null ? {} : { relatedEntityId: input.relatedEntityId }),
    ...(input.overdueOnly === null ? {} : { overdueOnly: input.overdueOnly }),
    ...(input.query === null ? {} : { query: input.query }),
    ...(input.offset === null ? {} : { offset: input.offset }),
    ...(input.limit === null ? {} : { limit: input.limit }),
  };
}

type ToolResultSummary = {
  outcome: "found" | "not_found" | "page" | "updated" | "reverted" | "unknown";
  returned?: number;
  total?: number;
  recordIds?: string[];
  recordId?: string;
  contentCharacters?: number;
  documentReferences?: number;
  changeId?: string;
};

function safeResultSummary(result: unknown): ToolResultSummary {
  if (typeof result !== "object" || result === null) return { outcome: "unknown" };
  if ("status" in result && result.status === "ok" && "changeId" in result) {
    return {
      outcome: "revertedChangeId" in result ? "reverted" : "updated",
      changeId: typeof result.changeId === "string" ? result.changeId : undefined,
    };
  }
  if ("page" in result) {
    const page = (result as { page: { returned: number; total: number } }).page;
    const items = "items" in result && Array.isArray(result.items)
      ? result.items as Array<{ id?: unknown }>
      : [];
    return {
      outcome: "page",
      returned: page.returned,
      total: page.total,
      recordIds: items
        .map((item) => item.id)
        .filter((id): id is string => typeof id === "string"),
    };
  }
  const outcome = "status" in result && result.status === "not_found"
    ? "not_found"
    : "found";
  const record = "record" in result && typeof result.record === "object"
    && result.record !== null
    ? result.record as { id?: unknown; content?: unknown; documents?: unknown }
    : null;
  return {
    outcome,
    ...(record && typeof record.id === "string" ? { recordId: record.id } : {}),
    ...(record && typeof record.content === "string"
      ? { contentCharacters: record.content.length }
      : {}),
    ...(record && Array.isArray(record.documents)
      ? { documentReferences: record.documents.length }
      : {}),
  };
}

function loggedExecution<TInput extends ToolInput, TResult>(
  logger: Logger,
  toolName: string,
  execute: (
    input: TInput,
    options: { toolCallId: string },
  ) => TResult | Promise<TResult>,
) {
  return async (
    input: TInput,
    options: { toolCallId: string },
  ): Promise<TResult | ToolFailure> => {
    const startedAt = performance.now();
    logger.debug({
      event: "agent.tool.started",
      toolName,
      toolCallId: options.toolCallId,
      ...toolInvocationDetails(input),
    }, "Starting agent tool");
    try {
      const result = await execute(input, options);
      const summary = safeResultSummary(result);
      const details = {
        event: "agent.tool.completed",
        toolName,
        toolCallId: options.toolCallId,
        ...toolInvocationDetails(input),
        ...summary,
        durationMs: Math.round(performance.now() - startedAt),
      };
      if (summary.outcome === "not_found") {
        logger.warn(details, "Agent tool lookup returned no record");
      } else {
        logger.debug(details, "Completed agent tool");
      }
      return result;
    } catch (error) {
      logger.error({
        event: "agent.tool.failed",
        toolName,
        toolCallId: options.toolCallId,
        ...toolInvocationDetails(input),
        durationMs: Math.round(performance.now() - startedAt),
        err: error,
      }, "Agent tool failed");
      if (error instanceof z.ZodError || error instanceof DomainValidationError) {
        return {
          status: "error",
          error: "validation_failed",
          message: error instanceof z.ZodError
            ? error.issues.map(issue => issue.message).join("; ")
            : error.message,
        };
      }
      if (error instanceof MutationError) {
        return { status: "error", error: error.code, message: error.message };
      }
      const message = error instanceof Error ? error.message : "";
      if (/^(Job|Contact) not found:/.test(message)) {
        return { status: "error", error: "not_found", message };
      }
      return {
        status: "error",
        error: "tool_failed",
        message: "The requested operation could not be completed.",
      };
    }
  };
}

function documentMutationResult(result: ManagedDocumentMutationResult) {
  const { content: _, ...document } = result.document;
  return {
    status: "ok" as const,
    changed: result.changed,
    changeId: result.changeId,
    document,
  };
}

export function createJobSearchTools(
  reader: AgentContextReader,
  logger: Logger,
  mutations?: JobSearchMutationCapabilities,
  requestContext?: { actor: string; requestId: string },
) {
  const readTools = {
    list_jobs: tool({
      strict: true,
      description: "List job opportunities in the candidate's pipeline. Use optional filters if desired. Results are summaries and may be paginated; use get_job with an ID when you need the complete current record.",
      inputSchema: listJobsInputSchema,
      execute: loggedExecution(logger, "list_jobs", (input) =>
        reader.listJobs(normalizeJobsInput(input))),
    }),
    get_job: tool({
      strict: true,
      description: "Get the complete current structured record for one job using its durable ID. Use this after list_jobs when summary fields are not sufficient. The result includes references for registered job-description and interview-preparation documents; use get_document to read one.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_job", ({ id }) => reader.getJob(id)),
    }),
    list_networking_contacts: tool({
      strict: true,
      description: "List people in the candidate's networking pipeline. Use optional filters if desired. Results are summaries and may be paginated; use get_networking_contact with an ID when you need the complete current record.",
      inputSchema: listContactsInputSchema,
      execute: loggedExecution(logger, "list_networking_contacts", (input) =>
        reader.listNetworkingContacts(normalizeContactsInput(input))),
    }),
    get_networking_contact: tool({
      strict: true,
      description: "Get the complete current structured networking record for one contact using its durable ID. Use this after list_networking_contacts when summary fields are not sufficient. The result includes a registered profile-document reference when available; use get_document to read it.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_networking_contact", ({ id }) => reader.getNetworkingContact(id)),
    }),
    list_tasks: tool({
      strict: true,
      description: "List job-search tasks. Use optional filters if desired. Results are summaries and may be paginated; use get_task with an ID when you need the complete current record.",
      inputSchema: listTasksInputSchema,
      execute: loggedExecution(logger, "list_tasks", (input) =>
        reader.listTasks(normalizeTasksInput(input))),
    }),
    get_task: tool({
      strict: true,
      description: "Get the complete current structured record for one job-search task using its durable ID. Use this after list_tasks when summary fields are not sufficient.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_task", ({ id }) => reader.getTask(id)),
    }),
    get_document: tool({
      strict: true,
      description: "Retrieve one registered job-search document using a reference returned by get_job or get_networking_contact. Managed-document results include the current version required for updates. Use only an exact supplied reference; this tool cannot browse files or arbitrary paths.",
      inputSchema: getDocumentInputSchema,
      execute: loggedExecution(
        logger,
        "get_document",
        ({ reference }) => reader.getDocument(reference),
      ),
    }),
  };
  if (!mutations || !requestContext) return readTools;
  return {
    ...readTools,
    update_job: tool({
      strict: true,
      description: "Update one existing job using explicit set or clear operations. Supply only desired changes, use dot paths for nested fields, and report the resulting record and change ID to the user.",
      inputSchema: updateJobInputSchema,
      execute: loggedExecution(
        logger,
        "update_job",
        ({ id, changes }, { toolCallId }) => ({
          status: "ok" as const,
          ...mutations.jobs.update({
            actor: requestContext.actor,
            source: "agent",
            summary: `Agent updated job ${id} (request ${requestContext.requestId}, tool ${toolCallId})`,
            changeId: `agent-tool:${toolCallId}`,
          }, id, jobPatchFromOperations(changes)),
        }),
      ),
    }),
    update_networking_contact: tool({
      strict: true,
      description: "Update one existing networking contact using explicit set or clear operations. Supply only desired changes, use dot paths for nested fields, and report the resulting record and change ID to the user.",
      inputSchema: updateNetworkingContactInputSchema,
      execute: loggedExecution(
        logger,
        "update_networking_contact",
        ({ id, changes }, { toolCallId }) => ({
          status: "ok" as const,
          ...mutations.networking.update({
            actor: requestContext.actor,
            source: "agent",
            summary: `Agent updated networking contact ${id} (request ${requestContext.requestId}, tool ${toolCallId})`,
            changeId: `agent-tool:${toolCallId}`,
          }, id, contactPatchFromOperations(changes)),
        }),
      ),
    }),
    create_document: tool({
      strict: true,
      description: "Create a managed text document for an existing job from content the user supplied. Use job_description for source material, preserve source details without invention, and report the stable reference, version, and change ID.",
      inputSchema: createDocumentInputSchema,
      execute: loggedExecution(
        logger,
        "create_document",
        (input, { toolCallId }) => documentMutationResult(
          mutations.documents.create({
            actor: requestContext.actor,
            source: "agent",
            summary: `Agent created ${input.documentType} for ${input.ownerType} ${input.ownerId} (request ${requestContext.requestId}, tool ${toolCallId})`,
            changeId: `agent-tool:${toolCallId}`,
          }, input),
        ),
      ),
    }),
    update_document: tool({
      strict: true,
      description: "Replace the content of one managed text document using its exact stable reference and current version. The prior content remains an immutable version; report whether a new version was created and its change ID.",
      inputSchema: updateDocumentInputSchema,
      execute: loggedExecution(
        logger,
        "update_document",
        (input, { toolCallId }) => documentMutationResult(
          mutations.documents.update({
            actor: requestContext.actor,
            source: "agent",
            summary: `Agent updated document ${input.reference} (request ${requestContext.requestId}, tool ${toolCallId})`,
            changeId: `agent-tool:${toolCallId}`,
          }, input),
        ),
      ),
    }),
    revert_change: tool({
      strict: true,
      description: "Revert one eligible prior change using its exact change ID. The revert is rejected if a later edit would be overwritten.",
      inputSchema: revertChangeInputSchema,
      execute: loggedExecution(
        logger,
        "revert_change",
        ({ changeId }, { toolCallId }) => ({
          status: "ok" as const,
          entity: "change" as const,
          ...mutations.changes.revert({
            actor: requestContext.actor,
            source: "agent",
            summary: `Agent reverted ${changeId} (request ${requestContext.requestId}, tool ${toolCallId})`,
            changeId: `agent-revert:${toolCallId}`,
          }, changeId),
        }),
      ),
    }),
  };
}

export type JobSearchTools = ReturnType<typeof createJobSearchTools>;
export const jobSearchToolSchemas = {
  list_jobs: listJobsInputSchema,
  get_job: getInputSchema,
  list_networking_contacts: listContactsInputSchema,
  get_networking_contact: getInputSchema,
  list_tasks: listTasksInputSchema,
  get_task: getInputSchema,
  get_document: getDocumentInputSchema,
  update_job: updateJobInputSchema,
  update_networking_contact: updateNetworkingContactInputSchema,
  create_document: createDocumentInputSchema,
  update_document: updateDocumentInputSchema,
  revert_change: revertChangeInputSchema,
} as const;
