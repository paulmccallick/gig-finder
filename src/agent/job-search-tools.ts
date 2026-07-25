import { tool } from "ai";
import type { Logger } from "pino";
import { z } from "zod";
import type { AgentContextReader } from "../core/src";
import { fitRatings, outcomes, pipelineStages } from "../core/src/jobs";
import {
  contactPriorities,
  contactStatuses,
  relationshipStrengths,
} from "../core/src/network";
import { taskPriorities, taskStatuses, taskTypes } from "../core/src/tasks";

const nonEmptyArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).min(1);

const pageSchema = {
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(20),
};

const listJobsInputSchema = z.object({
  stages: nonEmptyArray(pipelineStages).optional(),
  outcomes: nonEmptyArray(outcomes).optional(),
  fitRatings: nonEmptyArray(fitRatings).optional(),
  excludeStages: nonEmptyArray(pipelineStages).optional(),
  excludeOutcomes: nonEmptyArray(outcomes).optional(),
  excludeFitRatings: nonEmptyArray(fitRatings).optional(),
  overdueOnly: z.boolean().default(false),
  query: z.string().trim().optional(),
  ...pageSchema,
}).strict();

const listContactsInputSchema = z.object({
  statuses: nonEmptyArray(contactStatuses).optional(),
  priorities: nonEmptyArray(contactPriorities).optional(),
  relationshipStrengths: nonEmptyArray(relationshipStrengths).optional(),
  excludeStatuses: nonEmptyArray(contactStatuses).optional(),
  excludePriorities: nonEmptyArray(contactPriorities).optional(),
  excludeRelationshipStrengths: nonEmptyArray(relationshipStrengths).optional(),
  overdueOnly: z.boolean().default(false),
  query: z.string().trim().optional(),
  ...pageSchema,
}).strict();

const listTasksInputSchema = z.object({
  statuses: nonEmptyArray(taskStatuses).optional(),
  priorities: nonEmptyArray(taskPriorities).optional(),
  types: nonEmptyArray(taskTypes).optional(),
  excludeStatuses: nonEmptyArray(taskStatuses).optional(),
  excludePriorities: nonEmptyArray(taskPriorities).optional(),
  excludeTypes: nonEmptyArray(taskTypes).optional(),
  relatedEntityType: z.enum(["job", "contact", "general"]).optional(),
  relatedEntityId: z.string().trim().min(1).optional(),
  overdueOnly: z.boolean().default(false),
  query: z.string().trim().optional(),
  ...pageSchema,
}).strict();

const getInputSchema = z.object({
  id: z.string().trim().min(1),
}).strict();

const getDocumentInputSchema = z.object({
  reference: z.string().trim().min(1),
}).strict();

type SafeInput = {
  offset?: number;
  limit?: number;
  relatedEntityId?: string;
  id?: string;
  reference?: string;
};

export interface ToolFailure {
  status: "error";
  error: "tool_failed";
}

function safeLogInput(input: SafeInput) {
  const filters = Object.keys(input).filter((key) =>
    !["id", "relatedEntityId", "offset", "limit", "query"].includes(key)
  );
  return {
    ...(input.id === undefined ? {} : { recordId: input.id }),
    ...(input.reference === undefined ? {} : { documentReference: input.reference }),
    ...(input.relatedEntityId === undefined ? {} : { relatedEntityId: input.relatedEntityId }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(filters.length === 0 ? {} : { filters }),
  };
}

function loggedExecution<TInput extends SafeInput, TResult>(
  logger: Logger,
  toolName: string,
  execute: (input: TInput) => TResult | Promise<TResult>,
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
      ...safeLogInput(input),
    }, "Starting agent tool");
    try {
      const result = await execute(input);
      const resultSummary = "page" in (result as object)
        ? {
            returned: (result as { page: { returned: number } }).page.returned,
            total: (result as { page: { total: number } }).page.total,
          }
        : { outcome: (result as { status?: string }).status ?? "ok" };
      logger.debug({
        event: "agent.tool.completed",
        toolName,
        toolCallId: options.toolCallId,
        ...safeLogInput(input),
        ...resultSummary,
        durationMs: Math.round(performance.now() - startedAt),
      }, "Completed agent tool");
      return result;
    } catch (error) {
      logger.error({
        event: "agent.tool.failed",
        toolName,
        toolCallId: options.toolCallId,
        ...safeLogInput(input),
        durationMs: Math.round(performance.now() - startedAt),
        err: error,
      }, "Agent tool failed");
      return { status: "error", error: "tool_failed" };
    }
  };
}

export function createJobSearchTools(reader: AgentContextReader, logger: Logger) {
  return {
    list_jobs: tool({
      description: "List job opportunities in the candidate's pipeline. Use this to find or compare jobs by stage, outcome, fit, due status, or text. Results are summaries and may be paginated; use get_job with an ID when you need the complete current record.",
      inputSchema: listJobsInputSchema,
      execute: loggedExecution(logger, "list_jobs", (input) => reader.listJobs(input)),
    }),
    get_job: tool({
      description: "Get the complete current structured record for one job using its durable ID. Use this after list_jobs when summary fields are not sufficient. The result includes references for registered job-description and interview-preparation documents; use get_document to read one.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_job", ({ id }) => reader.getJob(id)),
    }),
    list_networking_contacts: tool({
      description: "List people in the candidate's networking pipeline. Use this to find or compare contacts by relationship status, priority, relationship strength, due status, or text. Results are summaries and may be paginated; use get_networking_contact with an ID when you need the complete current record.",
      inputSchema: listContactsInputSchema,
      execute: loggedExecution(logger, "list_networking_contacts", (input) => reader.listNetworkingContacts(input)),
    }),
    get_networking_contact: tool({
      description: "Get the complete current structured networking record for one contact using its durable ID. Use this after list_networking_contacts when summary fields are not sufficient. The result includes a registered profile-document reference when available; use get_document to read it.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_networking_contact", ({ id }) => reader.getNetworkingContact(id)),
    }),
    list_tasks: tool({
      description: "List job-search tasks. Use this to find or compare tasks by status, priority, type, related record, due status, or text. Results are summaries and may be paginated; use get_task with an ID when you need the complete current record.",
      inputSchema: listTasksInputSchema,
      execute: loggedExecution(logger, "list_tasks", (input) => reader.listTasks(input)),
    }),
    get_task: tool({
      description: "Get the complete current structured record for one job-search task using its durable ID. Use this after list_tasks when summary fields are not sufficient.",
      inputSchema: getInputSchema,
      execute: loggedExecution(logger, "get_task", ({ id }) => reader.getTask(id)),
    }),
    get_document: tool({
      description: "Retrieve one registered job-search document using a reference returned by get_job or get_networking_contact. Use only an exact reference supplied by those tools; this tool cannot browse files or arbitrary paths.",
      inputSchema: getDocumentInputSchema,
      execute: loggedExecution(
        logger,
        "get_document",
        ({ reference }) => reader.getDocument(reference),
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
} as const;
