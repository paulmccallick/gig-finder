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
  getJob: (id) => ({ status: "not_found", id }),
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
  getNetworkingContact: (id) => ({ status: "not_found", id }),
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
  getTask: (id) => ({ status: "not_found", id }),
} satisfies AgentContextReader;

describe("JobSearchAgent tools", () => {
  test("registers exactly the six approved tools with agent-facing descriptions", () => {
    const tools = createJobSearchTools(reader, logger);
    expect(Object.keys(tools)).toEqual([
      "list_jobs",
      "get_job",
      "list_networking_contacts",
      "get_networking_contact",
      "list_tasks",
      "get_task",
    ]);
    for (const definition of Object.values(tools)) {
      expect(definition.description?.length).toBeGreaterThan(40);
    }
  });

  test("validates inclusion and exclusion values from entity enums", () => {
    expect(jobSearchToolSchemas.list_jobs.parse({
      stages: [...pipelineStages],
      excludeFitRatings: [...fitRatings],
    })).toMatchObject({ stages: [...pipelineStages], excludeFitRatings: [...fitRatings] });
    expect(jobSearchToolSchemas.list_networking_contacts.parse({
      statuses: [...contactStatuses],
      excludeStatuses: ["paused"],
    }).excludeStatuses).toEqual(["paused"]);
    expect(jobSearchToolSchemas.list_tasks.parse({
      types: [...taskTypes],
      excludeTypes: ["other"],
    }).excludeTypes).toEqual(["other"]);
  });

  test("rejects unknown fields, invalid enums, empty arrays, and pagination outside bounds", () => {
    expect(jobSearchToolSchemas.list_jobs.safeParse({ stages: [] }).success).toBe(false);
    expect(jobSearchToolSchemas.list_jobs.safeParse({ stages: ["invalid"] }).success).toBe(false);
    expect(jobSearchToolSchemas.list_jobs.safeParse({ limit: 51 }).success).toBe(false);
    expect(jobSearchToolSchemas.list_tasks.safeParse({ offset: -1 }).success).toBe(false);
    expect(jobSearchToolSchemas.list_networking_contacts.safeParse({ unexpected: true }).success).toBe(false);
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
});
