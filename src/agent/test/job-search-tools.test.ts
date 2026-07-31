import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Logger } from "pino";
import {
  contactStatuses,
  fitRatings,
  jobPersonRelationships,
  meetingStatuses,
  pipelineStages,
  taskTypes,
  type ChangeContext,
  type Job,
  type ManagedDocumentRecord,
  type MeetingRecord,
  type NetworkContactRecord,
  StagedDocumentService,
} from "../../core/src";
import { MutationError } from "../../core/src/errors";
import {
  createJobSearchTools,
  jobSearchToolSchemas,
  type JobSearchReadCapabilities,
  type JobSearchMutationCapabilities,
} from "../job-search-tools";

const logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const documentMutations = {
  create: () => { throw new Error("not executed"); },
  update: () => { throw new Error("not executed"); },
};

const managedDocument: ManagedDocumentRecord = {
  id: "doc_11111111-1111-4111-8111-111111111111",
  links: [{ entityType: "job", entityId: "job-1" }],
  documentType: "job_description",
  title: "Job description",
  displayName: "Job description",
  mediaType: "text/plain",
  sourceDescription: "Provided by the recruiter",
  uploadProvenance: null,
  currentVersion: 1,
  content: "Original source text",
  contentHash: "abc123",
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
};

const contactRecord: NetworkContactRecord = {
  id: "contact-1",
  personId: "person-1",
  name: "Contact Person",
  company: "Example Company",
  title: "VP Engineering",
  linkedInProfileUrl: null,
  profileStatus: "missing",
  connectedOn: null,
  relationship: { type: "former_peer", strength: "strong", introducedBy: null, notes: null },
  priority: "high",
  status: "active_relationship",
  outreach: {
    lastContacted: null,
    lastContactMethod: null,
    lastContactSummary: null,
    nextAction: null,
    nextActionDue: null,
  },
  whyInteresting: null,
  notes: [],
  tags: [],
  source: { files: [] },
  createdAt: "2026-07-01",
  updatedAt: "2026-07-01",
  hasProfile: false,
  documents: [],
};

const reader = {
  jobs: { query: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }), read: (id) => ({ status: "not_found" as const, id }) },
  networking: { query: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }), read: (id) => ({ status: "not_found" as const, id }) },
  people: {
    query: input => ({ items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
    read: id => ({ status: "not_found" as const, id }),
  },
  jobPeople: {
    query: input => ({ status: "ok" as const, items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
    read: id => ({ status: "not_found" as const, id }),
  },
  tasks: { query: (input) => ({
    items: [],
    page: {
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      returned: 0,
      total: 0,
      hasMore: false,
      nextOffset: null,
    },
  }), read: (id) => ({ status: "not_found" as const, id }) },
  meetings: {
    query: input => ({ status: "ok" as const, items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
    read: id => ({ status: "not_found" as const, id }),
  },
  documents: {
    list: async () => [],
    get: async reference => ({ status: "not_found" as const, id: reference }),
  },
} satisfies JobSearchReadCapabilities;

const mutations: JobSearchMutationCapabilities = {
  jobs: { update: () => { throw new Error("not executed"); } },
  networking: { update: () => { throw new Error("not executed"); } },
  changes: { revert: () => { throw new Error("not executed"); } },
  documents: documentMutations,
};

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

const nullPeopleInput = { query: null, offset: null, limit: null } as const;
const nullRelationshipsInput = {
  jobIds: null,
  personIds: null,
  relationships: null,
  offset: null,
  limit: null,
} as const;
const nullMeetingsInput = {
  personIds: null,
  jobIds: null,
  statuses: null,
  startsFrom: null,
  startsThrough: null,
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
      "list_people",
      "get_person",
      "list_job_person_relationships",
      "get_job_person_relationship",
      "list_tasks",
      "get_task",
      "list_meetings",
      "get_meeting",
      "get_document",
    ]);
    for (const definition of Object.values(tools)) {
      expect(definition.description?.length).toBeGreaterThan(40);
      expect(definition.strict).toBe(true);
    }
  });

  test("registers mutation tools only when the update boundary is supplied", () => {
    const tools = createJobSearchTools(
      reader,
      logger,
      mutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    expect(Object.keys(tools)).toEqual([
      "list_jobs",
      "get_job",
      "list_networking_contacts",
      "get_networking_contact",
      "list_people",
      "get_person",
      "list_job_person_relationships",
      "get_job_person_relationship",
      "list_tasks",
      "get_task",
      "list_meetings",
      "get_meeting",
      "get_document",
      "update_job",
      "update_networking_contact",
      "create_document",
      "update_document",
      "revert_change",
    ]);
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");
    expect(tools.update_job.strict).toBe(true);
    expect(tools.update_networking_contact.strict).toBe(true);
    expect(tools.create_document.strict).toBe(true);
    expect(tools.update_document.strict).toBe(true);
    expect(tools.revert_change.strict).toBe(true);
  });

  test("reads standalone people and traversable job-person relationships", async () => {
    const tools = createJobSearchTools({
      ...reader,
      people: {
        query: input => ({
          items: [{
            id: "person-1",
            name: "Standalone Person",
            company: "Example",
            title: "VP Engineering",
            linkedInProfileUrl: null,
            connectedOn: null,
          }],
          page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
        }),
        read: id => ({ status: "not_found" as const, id }),
      },
      jobPeople: {
        query: input => ({
          status: "ok" as const,
          items: [{ id: "relation-1", jobId: input.jobIds?.[0] ?? "job-1", personId: "person-1", relationship: "hiring_manager" as const, notes: null }],
          page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
        }),
        read: id => ({ status: "not_found" as const, id }),
      },
    }, logger);
    const options = { toolCallId: "call-read", messages: [], abortSignal: undefined, context: {} };
    expect(await tools.list_people.execute?.(nullPeopleInput, options)).toMatchObject({
      items: [{ id: "person-1", name: "Standalone Person" }],
    });
    expect(await tools.list_job_person_relationships.execute?.({
      ...nullRelationshipsInput,
      jobIds: ["job-1"],
      relationships: ["hiring_manager"],
    }, options)).toMatchObject({
      status: "ok",
      items: [{ id: "relation-1", jobId: "job-1", personId: "person-1" }],
    });
  });

  test("includes every related job reference when getting a networking contact", async () => {
    const relationshipQueries: number[] = [];
    const tools = createJobSearchTools({
      ...reader,
      networking: {
        ...reader.networking,
        read: id => id === contactRecord.id
          ? { status: "ok" as const, record: contactRecord }
          : { status: "not_found" as const, id },
      },
      jobPeople: {
        ...reader.jobPeople,
        query: input => {
          relationshipQueries.push(input.offset ?? 0);
          const secondPage = input.offset === 1;
          return {
            status: "ok" as const,
            items: [{
              id: secondPage ? "relationship-2" : "relationship-1",
              jobId: secondPage ? "job-2" : "job-1",
              personId: "person-1",
              relationship: secondPage ? "former_peer" as const : "hiring_manager" as const,
              notes: null,
            }],
            page: {
              offset: input.offset ?? 0,
              limit: 50,
              returned: 1,
              total: 2,
              hasMore: !secondPage,
              nextOffset: secondPage ? null : 1,
            },
          };
        },
      },
    }, logger);

    const result = await tools.get_networking_contact.execute?.(
      { id: "contact-1" },
      { toolCallId: "call-contact", messages: [], abortSignal: undefined, context: {} },
    );

    expect(result).toMatchObject({
      status: "ok",
      record: {
        id: "contact-1",
        personId: "person-1",
        jobs: [
          { jobId: "job-1", relationship: "hiring_manager" },
          { jobId: "job-2", relationship: "former_peer" },
        ],
      },
    });
    expect(relationshipQueries).toEqual([0, 1]);
  });

  test("reads meetings with participant, job, date, status, and text filters", async () => {
    const logEntries: Array<Record<string, unknown>> = [];
    const meetingLogger = {
      debug: (entry: Record<string, unknown>) => logEntries.push(entry),
      warn: (entry: Record<string, unknown>) => logEntries.push(entry),
      error: (entry: Record<string, unknown>) => logEntries.push(entry),
    } as unknown as Logger;
    const record: MeetingRecord = {
      id: "meeting-1",
      title: "Hiring manager interview",
      startsAt: "2026-07-30T10:00:00-07:00",
      endsAt: "2026-07-30T11:00:00-07:00",
      timezone: "America/Los_Angeles",
      location: "Video",
      description: "Platform discussion",
      status: "completed",
      jobId: "job-1",
      personIds: ["person-1", "person-2"],
      externalCalendarId: null,
      externalEventId: null,
      revision: 1,
      isDeleted: false,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
    };
    const inputs: unknown[] = [];
    const tools = createJobSearchTools({
      ...reader,
      meetings: {
        query: input => {
          inputs.push(input);
          return { status: "ok" as const, items: [record], page: { offset: 0, limit: 10, returned: 1, total: 1, hasMore: false, nextOffset: null } };
        },
        read: id => id === record.id
          ? { status: "ok" as const, record }
          : { status: "not_found" as const, id },
      },
    }, meetingLogger);
    const options = { toolCallId: "call-meeting", messages: [], abortSignal: undefined, context: {} };
    const input = {
      ...nullMeetingsInput,
      personIds: ["person-1", "person-2"],
      jobIds: ["job-1"],
      statuses: ["completed"] as Array<"confirmed" | "completed">,
      startsFrom: "2026-07-01T00:00:00-07:00",
      startsThrough: "2026-07-31T23:59:59-07:00",
      query: "platform",
      offset: 0,
      limit: 10,
    };
    expect(await tools.list_meetings.execute?.(input, options)).toMatchObject({
      status: "ok",
      items: [{ id: "meeting-1", personIds: ["person-1", "person-2"], jobId: "job-1" }],
    });
    expect(inputs).toEqual([input]);
    expect(logEntries[0]).toMatchObject({
      event: "agent.tool.started",
      toolName: "list_meetings",
      appliedFilters: {
        personIds: ["person-1", "person-2"],
        jobIds: ["job-1"],
        statuses: ["completed"],
        startsFrom: "2026-07-01T00:00:00-07:00",
        startsThrough: "2026-07-31T23:59:59-07:00",
        query: { present: true, characters: 8 },
      },
      pagination: { offset: 0, limit: 10 },
    });
    expect(JSON.stringify(logEntries)).not.toContain("Hiring manager interview");
    expect(await tools.get_meeting.execute?.({ id: "meeting-1" }, options)).toMatchObject({
      status: "ok",
      record: { id: "meeting-1", personIds: ["person-1", "person-2"] },
    });
  });

  test("reads staged references and persists them through generic document tools", async () => {
    const stagedDocuments = new StagedDocumentService();
    const staged = stagedDocuments.stage({
      markdown: "# Exact uploaded source",
      provenance: {
        originalFilename: "role.pdf",
        detectedMediaType: "application/pdf",
        sourceContentHash: "a".repeat(64),
        converter: "pdfjs-dist",
        converterVersion: "6.2.108",
        extractionWarnings: [],
        uploadedAt: "2026-07-29T12:00:00.000Z",
      },
    });
    let createdInput: unknown;
    let createCalls = 0;
    const tools = createJobSearchTools(
      reader,
      logger,
      {
        ...mutations,
        documents: {
          create: (_context, input) => {
            createCalls += 1;
            createdInput = input;
            return {
              document: {
                ...managedDocument,
                mediaType: "text/markdown",
                content: input.content,
                uploadProvenance: input.uploadProvenance ?? null,
              },
              changeId: "agent-tool:call-upload",
              changed: true,
            };
          },
          update: () => { throw new Error("not executed"); },
        },
      },
      { actor: "Candidate", requestId: "request-upload" },
      {
        contextSearch: {
          search: () => ({
            jobs: [],
            networkingContacts: [],
            truncated: false,
          }),
        },
        stagedDocuments,
      },
    );
    expect(Object.keys(tools)).toContain("search_jobs_and_contacts");
    expect(Object.keys(tools)).not.toContain("get_staged_document");
    expect(Object.keys(tools)).not.toContain("create_uploaded_document");
    const stagedRead = await tools.get_document.execute?.({
      reference: staged.reference,
    }, {
      toolCallId: "read-upload",
      messages: [],
      abortSignal: undefined,
      context: {},
    });
    expect(stagedRead).toMatchObject({
      status: "ok",
      record: {
        reference: staged.reference,
        storage: "staged",
        content: "# Exact uploaded source",
      },
    });
    if (!("create_document" in tools)) throw new Error("Document tool missing.");
    const createDocument = tools.create_document;
    if (!createDocument) throw new Error("Document tool missing.");

    const stagedToolInput: z.infer<typeof jobSearchToolSchemas.create_document> = {
      links: [{ entityType: "job", entityId: "job-1" }],
      documentType: "job_description",
      title: "Director role",
      sourceKind: "staged_document",
      content: null,
      reference: staged.reference,
      mediaType: "text/markdown",
      sourceDescription: null,
    };
    const result = await createDocument.execute?.(stagedToolInput, {
      toolCallId: "call-upload",
      messages: [],
      abortSignal: undefined,
      context: {},
    });

    expect(createdInput).toMatchObject({
      content: "# Exact uploaded source",
      mediaType: "text/markdown",
      uploadProvenance: { originalFilename: "role.pdf" },
    });
    expect(result).toMatchObject({ status: "ok", changed: true });
    expect(stagedDocuments.get(staged.reference)?.consumption).toMatchObject({
      changeId: "agent-tool:call-upload",
      document: { id: managedDocument.id },
    });
    const retried = await createDocument.execute?.(stagedToolInput, {
      toolCallId: "call-upload-retry",
      messages: [],
      abortSignal: undefined,
      context: {},
    });
    expect(createCalls).toBe(1);
    expect(retried).toEqual(result);
  });

  test("accepts explicit mutation operations and rejects invalid fields", () => {
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [
        { operation: "set", field: "stage", value: "applied" },
        { operation: "set", field: "fit.rating", value: "strong" },
      ],
    }).success).toBe(true);
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [{ operation: "set", field: "id", value: "different" }],
    }).success).toBe(false);
    expect(jobSearchToolSchemas.update_networking_contact.safeParse({
      id: "person-1",
      changes: [{ operation: "set", field: "status", value: "awaiting_response" }],
    }).success).toBe(true);
    expect(jobSearchToolSchemas.update_networking_contact.safeParse({
      id: "person-1",
      changes: [{ operation: "set", field: "updatedAt", value: "2026-07-27" }],
    }).success).toBe(false);
  });

  test("uses strict document schemas with domain enum values", () => {
    expect(jobSearchToolSchemas.create_document.parse({
      links: [{ entityType: "job", entityId: "job-1" }],
      documentType: "job_description",
      title: "Job description",
      sourceKind: "inline_content",
      content: "Supplied source text",
      reference: null,
      mediaType: "text/plain",
      sourceDescription: null,
    })).toMatchObject({
      links: [{ entityType: "job", entityId: "job-1" }],
      documentType: "job_description",
      sourceKind: "inline_content",
      mediaType: "text/plain",
    });
    expect(jobSearchToolSchemas.create_document.safeParse({
      links: [{ entityType: "contact", entityId: "contact-1" }],
      documentType: "job_description",
      title: "Job description",
      sourceKind: "inline_content",
      content: "Supplied source text",
      reference: null,
      mediaType: "text/plain",
      sourceDescription: null,
    }).success).toBe(false);
    expect(jobSearchToolSchemas.create_document.safeParse({
      links: [{ entityType: "job", entityId: "job-1" }],
      documentType: "job_description",
      title: "Job description",
      sourceKind: "staged_document",
      content: "Opaque references cannot be stored as content.",
      reference: "staged-document:11111111-1111-4111-8111-111111111111",
      mediaType: "text/markdown",
      sourceDescription: null,
    }).success).toBe(false);
    expect(jobSearchToolSchemas.update_document.safeParse({
      documentId: managedDocument.id,
      expectedVersion: 0,
      content: "Replacement text",
      changeSummary: "Corrected source",
    }).success).toBe(false);
  });

  test("passes document writes through the shared service and omits content from results", async () => {
    let received:
      | { context: ChangeContext; input: unknown }
      | undefined;
    const tools = createJobSearchTools(
      reader,
      logger,
      {
        jobs: { update: () => { throw new Error("not executed"); } },
        networking: { update: () => { throw new Error("not executed"); } },
        changes: { revert: () => { throw new Error("not executed"); } },
        documents: {
          create: (context, input) => {
            received = { context, input };
            return {
              document: managedDocument,
              changeId: context.changeId ?? null,
              changed: true,
            };
          },
          update: () => { throw new Error("not executed"); },
        },
      },
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("create_document" in tools)) {
      throw new Error("Mutation tools were not registered.");
    }

    const result = await tools.create_document.execute?.(
      {
        links: [{ entityType: "job", entityId: "job-1" }],
        documentType: "job_description",
        title: "Job description",
        sourceKind: "inline_content",
        content: "Original source text",
        reference: null,
        mediaType: "text/plain",
        sourceDescription: "Provided by the recruiter",
      },
      {
        toolCallId: "call-document",
        messages: [],
        abortSignal: undefined,
        context: {},
      },
    );

    expect(received).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: "Agent created job_description (request request-1, tool call-document)",
        changeId: "agent-tool:call-document",
      },
      input: {
        links: [{ entityType: "job", entityId: "job-1" }],
        documentType: "job_description",
        title: "Job description",
        mediaType: "text/plain",
        sourceDescription: "Provided by the recruiter",
        content: "Original source text",
      },
    });
    expect(result).toMatchObject({
      status: "ok",
      changed: true,
      changeId: "agent-tool:call-document",
      document: {
        id: managedDocument.id,
        currentVersion: 1,
      },
    });
    expect((result as { document?: object }).document).not.toHaveProperty("content");
  });

  test("updates documents by exact ID and expected version", async () => {
    let received:
      | { context: ChangeContext; input: unknown }
      | undefined;
    const tools = createJobSearchTools(
      reader,
      logger,
      {
        jobs: { update: () => { throw new Error("not executed"); } },
        networking: { update: () => { throw new Error("not executed"); } },
        changes: { revert: () => { throw new Error("not executed"); } },
        documents: {
          create: () => { throw new Error("not executed"); },
          update: (context, input) => {
            received = { context, input };
            return {
              document: {
                ...managedDocument,
                currentVersion: 2,
                content: "Corrected source text",
              },
              changeId: context.changeId ?? null,
              changed: true,
            };
          },
        },
      },
      { actor: "Candidate", requestId: "request-2" },
    );
    if (!("update_document" in tools)) {
      throw new Error("Mutation tools were not registered.");
    }

    const result = await tools.update_document.execute?.(
      {
        documentId: managedDocument.id,
        expectedVersion: 1,
        content: "Corrected source text",
        changeSummary: "Corrected transcription",
      },
      {
        toolCallId: "call-document-update",
        messages: [],
        abortSignal: undefined,
        context: {},
      },
    );

    expect(received).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: `Agent updated document ${managedDocument.id} (request request-2, tool call-document-update)`,
        changeId: "agent-tool:call-document-update",
      },
      input: {
        documentId: managedDocument.id,
        expectedVersion: 1,
        content: "Corrected source text",
        changeSummary: "Corrected transcription",
      },
    });
    expect(result).toMatchObject({
      status: "ok",
      changed: true,
      document: {
        id: managedDocument.id,
        currentVersion: 2,
      },
    });
  });

  test("describes accepted update values using domain enums", () => {
    const jobSchema = z.toJSONSchema(jobSearchToolSchemas.update_job);
    const contactSchema = z.toJSONSchema(
      jobSearchToolSchemas.update_networking_contact,
    );
    const descriptions = JSON.stringify({ jobSchema, contactSchema });
    for (const value of [
      ...pipelineStages,
      ...fitRatings,
      ...contactStatuses,
    ]) {
      expect(descriptions).toContain(value);
    }
  });

  test("leaves field-value compatibility to the core update contract", async () => {
    let called = false;
    const tools = createJobSearchTools(
      reader,
      logger,
      {
        jobs: { update: () => {
          called = true;
          throw new Error("not expected");
        } },
        networking: { update: () => { throw new Error("not executed"); } },
        changes: { revert: () => { throw new Error("not executed"); } },
        documents: documentMutations,
      },
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_job.execute?.(
      {
        id: "job-1",
        changes: [{ operation: "set", field: "stage", value: 123 }],
      },
      { toolCallId: "call-invalid", messages: [], abortSignal: undefined, context: {} },
    )).toMatchObject({
      status: "error",
      error: "validation_failed",
    });
    expect(called).toBe(false);
  });

  test("requires explicit valid clear operations", () => {
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [{ operation: "clear", field: "nextAction", value: null }],
    }).success).toBe(true);
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [{ operation: "clear", field: "stage", value: null }],
    }).success).toBe(false);
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [{ operation: "clear", field: "sourceUrl", value: "wrong" }],
    }).success).toBe(false);
    expect(jobSearchToolSchemas.update_job.safeParse({
      id: "job-1",
      changes: [
        { operation: "clear", field: "nextAction", value: null },
        { operation: "set", field: "nextAction.description", value: "Follow up" },
      ],
    }).success).toBe(false);
  });

  test("passes request and tool-call identity through the mutation boundary", async () => {
    let received: {
      context: ChangeContext;
      id: string;
      patch: unknown;
    } | undefined;
    const record: Job = {
      id: "job-1",
      company: "Company",
      title: "Director",
      jobId: null,
      roleDirectory: null,
      stage: "applied",
      outcome: "pending",
      statusSummary: "Applied",
      lastActivity: "2026-07-27",
      nextAction: null,
      fit: { rating: "good", summary: null },
      payRange: null,
      sourceUrl: null,
      tags: [],
      hasJobDescription: false,
      hasInterviewPrep: false,
      location: null,
      workArrangement: null,
      postedDate: null,
      businessUnitTeam: null,
      recruiterSource: null,
      bonus: null,
      equity: null,
      otherCompensation: null,
    };
    const capturingMutations: JobSearchMutationCapabilities = {
      jobs: { update: (context, id, patch) => {
        received = { context, id, patch };
        return {
          changeId: context.changeId ?? null,
          record,
        };
      } },
      networking: { update: () => { throw new Error("not executed"); } },
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createJobSearchTools(
      reader,
      logger,
      capturingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");

    const result = await tools.update_job.execute?.(
      {
        id: "job-1",
        changes: [
          { operation: "set", field: "stage", value: "applied" },
          { operation: "set", field: "fit.rating", value: "strong" },
          { operation: "clear", field: "sourceUrl", value: null },
        ],
      },
      { toolCallId: "call-9", messages: [], abortSignal: undefined, context: {} },
    );

    expect(received).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: "Agent updated job job-1 (request request-1, tool call-9)",
        changeId: "agent-tool:call-9",
      },
      id: "job-1",
      patch: {
        stage: "applied",
        fit: { rating: "strong" },
        sourceUrl: null,
      },
    });
    expect(result).toMatchObject({
      status: "ok",
      changeId: "agent-tool:call-9",
    });
  });

  test("returns a structured duplicate result", async () => {
    const duplicateMutations: JobSearchMutationCapabilities = {
      jobs: { update: () => {
        throw new MutationError("duplicate_change", "Already applied");
      } },
      networking: { update: () => { throw new Error("not executed"); } },
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createJobSearchTools(
      reader,
      logger,
      duplicateMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_job.execute?.(
      {
        id: "job-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-9", messages: [], abortSignal: undefined, context: {} },
    )).toEqual({
      status: "error",
      error: "duplicate_change",
      message: "Already applied",
    });
  });

  test("returns a structured revision-conflict result", async () => {
    const conflictingMutations: JobSearchMutationCapabilities = {
      jobs: { update: () => {
        throw new MutationError(
          "revision_conflict",
          "Job job-1 was updated concurrently.",
        );
      } },
      networking: { update: () => { throw new Error("not executed"); } },
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createJobSearchTools(
      reader,
      logger,
      conflictingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_job.execute?.(
      {
        id: "job-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-9", messages: [], abortSignal: undefined, context: {} },
    )).toEqual({
      status: "error",
      error: "revision_conflict",
      message: "Job job-1 was updated concurrently.",
    });
  });

  test("passes any exact change ID through the generic revert tool", async () => {
    let received: { context: ChangeContext; targetChangeId: string } | undefined;
    const capturingMutations: JobSearchMutationCapabilities = {
      jobs: { update: () => { throw new Error("not executed"); } },
      networking: { update: () => { throw new Error("not executed"); } },
      changes: { revert: (context, targetChangeId) => {
        received = { context, targetChangeId };
        return {
          changeId: context.changeId ?? "generated",
          revertedChangeId: targetChangeId,
          affected: [{ entity: "job", id: "job-1" }],
        };
      } },
      documents: documentMutations,
    };
    const tools = createJobSearchTools(
      reader,
      logger,
      capturingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("revert_change" in tools)) {
      throw new Error("Mutation tools were not registered.");
    }

    expect(await tools.revert_change.execute?.(
      { changeId: "change:from-cli" },
      { toolCallId: "call-revert", messages: [], abortSignal: undefined, context: {} },
    )).toMatchObject({
      status: "ok",
      changeId: "agent-revert:call-revert",
      revertedChangeId: "change:from-cli",
    });
    expect(received).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: "Agent reverted change:from-cli (request request-1, tool call-revert)",
        changeId: "agent-revert:call-revert",
      },
      targetChangeId: "change:from-cli",
    });
  });

  test("logs update fields and the resulting change without treating them as filters", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    const record = {
      id: "job-1",
      company: "Company",
      title: "Director",
      jobId: null,
      roleDirectory: null,
      stage: "applied",
      outcome: "pending",
      statusSummary: "Applied",
      lastActivity: "2026-07-27",
      nextAction: null,
      fit: { rating: "good" as const, summary: null },
      payRange: null,
      sourceUrl: null,
      tags: [],
      location: null,
      workArrangement: null,
      postedDate: null,
      businessUnitTeam: null,
      recruiterSource: null,
      bonus: null,
      equity: null,
      otherCompensation: null,
    } satisfies Job;
    const loggingMutations: JobSearchMutationCapabilities = {
      jobs: { update: context => ({
        changeId: context.changeId ?? null,
        record,
      }) },
      networking: { update: () => { throw new Error("not executed"); } },
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createJobSearchTools(
      reader,
      capturingLogger,
      loggingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_job" in tools)) throw new Error("Mutation tools were not registered.");

    await tools.update_job.execute?.(
      {
        id: "job-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-log", messages: [], abortSignal: undefined, context: {} },
    );

    expect(entries[0]).toMatchObject({
      event: "agent.tool.started",
      recordId: "job-1",
      updateFields: ["stage"],
      appliedFilters: {},
    });
    expect(entries[1]).toMatchObject({
      event: "agent.tool.completed",
      outcome: "updated",
      changeId: "agent-tool:call-log",
    });
    expect(entries[1]).not.toHaveProperty("changedFields");
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
    expect(jobSearchToolSchemas.list_job_person_relationships.parse({
      ...nullRelationshipsInput,
      relationships: [...jobPersonRelationships],
    }).relationships).toEqual([...jobPersonRelationships]);
    expect(jobSearchToolSchemas.list_meetings.parse({
      ...nullMeetingsInput,
      statuses: [...meetingStatuses],
    }).statuses).toEqual([...meetingStatuses]);
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
      relationships: z.toJSONSchema(jobSearchToolSchemas.list_job_person_relationships),
      meetings: z.toJSONSchema(jobSearchToolSchemas.list_meetings),
    });
    for (const value of [...pipelineStages, ...fitRatings, ...contactStatuses, ...taskTypes, ...jobPersonRelationships, ...meetingStatuses]) {
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
      [jobSearchToolSchemas.list_people, nullPeopleInput],
      [jobSearchToolSchemas.list_job_person_relationships, nullRelationshipsInput],
      [jobSearchToolSchemas.list_meetings, nullMeetingsInput],
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

  test("generates strict-compatible mutation schemas at every object level", () => {
    const assertStrictObjects = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        const properties = schema.properties as Record<string, unknown>;
        expect(schema.additionalProperties).toBe(false);
        expect((schema.required as string[]).sort()).toEqual(
          Object.keys(properties).sort(),
        );
      }
      for (const value of Object.values(schema)) {
        if (Array.isArray(value)) value.forEach(assertStrictObjects);
        else assertStrictObjects(value);
      }
    };
    for (const schema of [
      jobSearchToolSchemas.update_job,
      jobSearchToolSchemas.update_networking_contact,
      jobSearchToolSchemas.create_document,
      jobSearchToolSchemas.update_document,
    ]) {
      const jsonSchema = z.toJSONSchema(schema);
      assertStrictObjects(jsonSchema);
    }
  });

  test("generates a Codex-compatible flat document source schema", () => {
    const jsonSchema = z.toJSONSchema(jobSearchToolSchemas.create_document);
    expect(jsonSchema.properties).toHaveProperty("sourceKind");
    expect(jsonSchema.properties).toHaveProperty("content");
    expect(jsonSchema.properties).toHaveProperty("reference");
    expect(jsonSchema.properties).not.toHaveProperty("source");
    expect(JSON.stringify(jsonSchema)).not.toContain('"oneOf"');
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
