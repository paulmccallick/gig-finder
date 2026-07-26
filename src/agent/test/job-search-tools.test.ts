import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Logger } from "pino";
import {
  contactStatuses,
  fitRatings,
  pipelineStages,
  taskTypes,
  type AgentContextReader,
} from "../../core/src";
import {
  createJobSearchTools,
  jobSearchToolSchemas,
} from "../job-search-tools";

const logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const reader = {
  listJobs: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }),
  getJob: async (id) => ({ status: "not_found", id }),
  listNetworkingContacts: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }),
  getNetworkingContact: async (id) => ({ status: "not_found", id }),
  listTasks: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }),
  getTask: async (id) => ({ status: "not_found", id }),
  getDocument: async (reference) => ({ status: "not_found", id: reference }),
} satisfies AgentContextReader;

const nullJobsInput = {
  stages: null,
  outcomes: null,
  fitRatings: null,
  overdueOnly: null,
  query: null,
  offset: null,
  limit: null,
} as const;

const nullContactsInput = {
  statuses: null,
  priorities: null,
  relationshipStrengths: null,
  overdueOnly: null,
  query: null,
  offset: null,
  limit: null,
} as const;

const nullTasksInput = {
  statuses: null,
  priorities: null,
  types: null,
  relatedEntityType: null,
  relatedEntityId: null,
  overdueOnly: null,
  query: null,
  offset: null,
  limit: null,
} as const;

describe("JobSearchAgent tools", () => {
  test("registers the approved tools with agent-facing descriptions", () => {
    const tools = createJobSearchTools(reader, logger);
    expect(Object.keys(tools)).toEqual([
      "list_jobs",
      "get_job",
      "list_networking_contacts",
      "get_networking_contact",
      "list_tasks",
      "get_task",
      "get_document",
    ]);
    for (const definition of Object.values(tools)) {
      expect(definition.description?.length).toBeGreaterThan(40);
      expect(definition.strict).toBe(true);
    }
  });

  test("validates inclusion values from entity enums", () => {
    expect(jobSearchToolSchemas.list_jobs.parse({
      ...nullJobsInput,
      stages: [...pipelineStages],
      fitRatings: [...fitRatings],
    })).toMatchObject({ stages: [...pipelineStages], fitRatings: [...fitRatings] });
    expect(jobSearchToolSchemas.list_networking_contacts.parse({
      ...nullContactsInput,
      statuses: [...contactStatuses],
    }).statuses).toEqual([...contactStatuses]);
    expect(jobSearchToolSchemas.list_tasks.parse({
      ...nullTasksInput,
      types: [...taskTypes],
    }).types).toEqual([...taskTypes]);
  });

  test("rejects unknown fields, invalid enums, empty arrays, and pagination outside bounds", () => {
    expect(jobSearchToolSchemas.list_jobs.safeParse({ ...nullJobsInput, stages: [] }).success).toBe(false);
    expect(jobSearchToolSchemas.list_jobs.safeParse({ ...nullJobsInput, stages: ["invalid"] }).success).toBe(false);
    expect(jobSearchToolSchemas.list_jobs.safeParse({ ...nullJobsInput, limit: 51 }).success).toBe(false);
    expect(jobSearchToolSchemas.list_tasks.safeParse({ ...nullTasksInput, offset: -1 }).success).toBe(false);
    expect(jobSearchToolSchemas.list_networking_contacts.safeParse({
      ...nullContactsInput,
      unexpected: true,
    }).success).toBe(false);
  });

  test("communicates all enum values in model-facing JSON Schema", () => {
    const schemas = JSON.stringify({
      jobs: z.toJSONSchema(jobSearchToolSchemas.list_jobs),
      contacts: z.toJSONSchema(jobSearchToolSchemas.list_networking_contacts),
      tasks: z.toJSONSchema(jobSearchToolSchemas.list_tasks),
    });
    for (const value of [...pipelineStages, ...fitRatings, ...contactStatuses, ...taskTypes]) {
      expect(schemas).toContain(`"${value}"`);
    }
  });

  test("describes every parameter in model-facing JSON Schema", () => {
    for (const schema of Object.values(jobSearchToolSchemas)) {
      const jsonSchema = z.toJSONSchema(schema);
      for (const property of Object.values(jsonSchema.properties ?? {})) {
        expect(property).toHaveProperty("description");
        expect((property as { description?: string }).description?.length)
          .toBeGreaterThan(10);
      }
    }
  });

  test("makes every list argument required and nullable for strict mode", () => {
    for (const [schema, nullInput] of [
      [jobSearchToolSchemas.list_jobs, nullJobsInput],
      [jobSearchToolSchemas.list_networking_contacts, nullContactsInput],
      [jobSearchToolSchemas.list_tasks, nullTasksInput],
    ] as const) {
      const jsonSchema = z.toJSONSchema(schema);
      expect(jsonSchema.required?.sort()).toEqual(
        Object.keys(jsonSchema.properties ?? {}).sort(),
      );
      expect(jsonSchema.additionalProperties).toBe(false);
      expect(schema.parse(nullInput)).toEqual(nullInput);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  test("logs only filters applied to a tool invocation", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: (entry: Record<string, unknown>) => entries.push(entry),
      error: () => undefined,
    } as unknown as Logger;
    const tools = createJobSearchTools(reader, capturingLogger);

    await tools.list_jobs.execute?.(
      {
        ...nullJobsInput,
        stages: ["technical_interview"],
        outcomes: ["pending"],
        overdueOnly: false,
        offset: 20,
        limit: 10,
      },
      { toolCallId: "call-1", messages: [], abortSignal: undefined, context: {} },
    );

    expect(entries[0]).toMatchObject({
      event: "agent.tool.started",
      filterMode: "filtered",
      appliedFilters: {
        stages: ["technical_interview"],
        outcomes: ["pending"],
      },
      pagination: { offset: 20, limit: 10 },
    });
    expect(entries[0]?.appliedFilters).not.toHaveProperty("overdueOnly");
  });

  test("labels a default list invocation as unfiltered", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: (entry: Record<string, unknown>) => entries.push(entry),
      error: () => undefined,
    } as unknown as Logger;
    const tools = createJobSearchTools(reader, capturingLogger);

    await tools.list_jobs.execute?.(
      { ...nullJobsInput, overdueOnly: false, offset: 0, limit: 20 },
      { toolCallId: "call-2", messages: [], abortSignal: undefined, context: {} },
    );

    expect(entries[0]).toMatchObject({
      event: "agent.tool.started",
      filterMode: "unfiltered",
      appliedFilters: {},
      pagination: { offset: 0, limit: 20 },
    });
  });

  test("warns when an application lookup returns not found", async () => {
    const debugEntries: Array<Record<string, unknown>> = [];
    const warningEntries: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      debug: (entry: Record<string, unknown>) => debugEntries.push(entry),
      warn: (entry: Record<string, unknown>) => warningEntries.push(entry),
      error: () => undefined,
    } as unknown as Logger;
    const tools = createJobSearchTools(reader, capturingLogger);

    await tools.get_job.execute?.(
      { id: "missing-job" },
      { toolCallId: "call-3", messages: [], abortSignal: undefined, context: {} },
    );

    expect(debugEntries).toHaveLength(1);
    expect(warningEntries).toHaveLength(1);
    expect(warningEntries[0]).toMatchObject({
      event: "agent.tool.completed",
      toolName: "get_job",
      toolCallId: "call-3",
      recordId: "missing-job",
      outcome: "not_found",
    });
  });
});
