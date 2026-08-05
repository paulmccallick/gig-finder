import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Logger } from "pino";
import {
  personStatuses,
  fitRatings,
  gigInputSchema,
  gigPersonRelationships,
  meetingStatuses,
  pipelineStages,
  taskPriorities,
  taskStatuses,
  taskTypes,
  type ChangeContext,
  type Gig,
  type ManagedDocumentRecord,
  type MeetingRecord,
  type PersonRecord,
  type TaskRecord,
  StagedDocumentService,
} from "../../core";
import {
  MutationError,
  PersistenceConsistencyError,
} from "../../core/errors";
import {
  createGigFinderTools,
  gigFinderToolSchemas,
  type GigFinderReadCapabilities,
  type GigFinderMutationCapabilities,
} from "../gig-finder-tools";
import { validateStrictToolJsonSchema } from "./strict-tool-schema";

const logger = {
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const documentMutations = {
  create: () => { throw new Error("not executed"); },
  update: () => { throw new Error("not executed"); },
};

const meetingMutations: GigFinderMutationCapabilities["meetings"] = {
  create: () => { throw new Error("not executed"); },
  update: () => { throw new Error("not executed"); },
};

const taskMutations: GigFinderMutationCapabilities["tasks"] = {
  createNew: () => { throw new Error("not executed"); },
  update: () => { throw new Error("not executed"); },
};

const managedDocument: ManagedDocumentRecord = {
  id: "doc_11111111-1111-4111-8111-111111111111",
  links: [{ entityType: "gig", entityId: "gig-1" }],
  documentType: "job_description",
  title: "Job description",
  description: null,
  displayName: "Job description",
  mediaType: "text/plain",
  sourceDescription: "Provided by the recruiter",
  filePath: null,
  uploadProvenance: null,
  currentVersion: 1,
  content: "Original source text",
  contentHash: "abc123",
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
};

const personRecord: PersonRecord = {
  id: "person-1",
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
  createdAt: "2026-07-01",
  updatedAt: "2026-07-01",
  hasProfile: false,
  documents: [],
};

const reader = {
  gigs: { query: (input) => ({
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
  gigPeople: {
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
} satisfies GigFinderReadCapabilities;

const mutations: GigFinderMutationCapabilities = {
  gigs: { createNew: () => { throw new Error("not executed"); }, update: () => { throw new Error("not executed"); } },
  people: { createNew: () => { throw new Error("not executed"); }, update: () => { throw new Error("not executed"); } },
  gigPeople: { createNew: () => { throw new Error("not executed"); } },
  tasks: taskMutations,
  meetings: meetingMutations,
  changes: { revert: () => { throw new Error("not executed"); } },
  documents: documentMutations,
};

const nullGigsInput = {
  stages: null,
  outcomes: null,
  fitRatings: null,
  overdueOnly: null,
  query: null,
  offset: null,
  limit: null,
} as const;

const nullPeopleInput = {
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

const nullRelationshipsInput = {
  gigIds: null,
  personIds: null,
  relationships: null,
  offset: null,
  limit: null,
} as const;
const nullMeetingsInput = {
  personIds: null,
  gigIds: null,
  statuses: null,
  startsFrom: null,
  startsThrough: null,
  query: null,
  offset: null,
  limit: null,
} as const;

describe("GigFinderAgent tools", () => {
  test("registers the approved tools with agent-facing descriptions", () => {
    const tools = createGigFinderTools(reader, logger);
    expect(Object.keys(tools)).toEqual([
      "list_gigs",
      "get_gig",
      "list_people",
      "get_person",
      "list_gig_person_relationships",
      "get_gig_person_relationship",
      "list_tasks",
      "get_task",
      "list_meetings",
      "get_meeting",
      "list_documents",
      "list_document_versions",
      "get_document",
    ]);
    for (const definition of Object.values(tools)) {
      expect(definition.description?.length).toBeGreaterThan(40);
      expect(definition.strict).toBe(true);
    }
  });

  test("registers mutation tools only when the update boundary is supplied", () => {
    const tools = createGigFinderTools(
      reader,
      logger,
      mutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    expect(Object.keys(tools)).toEqual([
      "list_gigs",
      "get_gig",
      "list_people",
      "get_person",
      "list_gig_person_relationships",
      "get_gig_person_relationship",
      "list_tasks",
      "get_task",
      "list_meetings",
      "get_meeting",
      "list_documents",
      "list_document_versions",
      "get_document",
      "create_gig",
      "update_gig",
      "update_person",
      "create_person",
      "create_gig_person_relationship",
      "create_task",
      "update_task",
      "create_meeting",
      "update_meeting",
      "create_document",
      "update_document",
      "revert_change",
    ]);
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");
    expect(tools.update_gig.strict).toBe(true);
    expect(tools.update_person.strict).toBe(true);
    expect(tools.create_task.strict).toBe(true);
    expect(tools.update_task.strict).toBe(true);
    expect(tools.create_meeting.strict).toBe(true);
    expect(tools.update_meeting.strict).toBe(true);
    expect(tools.create_document.strict).toBe(true);
    expect(tools.update_document.strict).toBe(true);
    expect(tools.revert_change.strict).toBe(true);
  });

  test("keeps read-only and mutation-enabled runtime tools in exact registry parity", () => {
    const extensions = {
      contextSearch: {
        search: () => ({ gigs: [], people: [], truncated: false }),
      },
    };
    const readOnly = createGigFinderTools(reader, logger, undefined, undefined, extensions);
    const writable = createGigFinderTools(
      reader,
      logger,
      mutations,
      { actor: "Candidate", requestId: "request-parity" },
      extensions,
    );
    const mutationNames = new Set([
      "create_gig", "update_gig", "update_person", "create_person",
      "create_gig_person_relationship", "create_task", "update_task",
      "create_meeting", "update_meeting", "create_document", "update_document",
      "revert_change",
    ]);
    const registryNames = Object.keys(gigFinderToolSchemas);
    expect(Object.keys(readOnly).sort()).toEqual(
      registryNames.filter(name => !mutationNames.has(name)).sort(),
    );
    expect(Object.keys(writable).sort()).toEqual(registryNames.sort());
    for (const [name, registeredTool] of Object.entries(writable)) {
      if (!mutationNames.has(name)) continue;
      expect(registeredTool.description).not.toMatch(/report .*(?:change|document|record) ID/i);
    }
  });

  test("reads standalone people and traversable gig-person relationships", async () => {
    const tools = createGigFinderTools({
      ...reader,
      people: {
        query: input => ({
          items: [{
            ...personRecord,
            name: "Standalone Person",
            company: "Example",
            title: "VP Engineering",
          }],
          page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
        }),
        read: id => ({ status: "not_found" as const, id }),
      },
      gigPeople: {
        query: input => ({
          status: "ok" as const,
          items: [{ id: "relation-1", gigId: input.gigIds?.[0] ?? "gig-1", personId: "person-1", relationship: "hiring_manager" as const, notes: null }],
          page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
        }),
        read: id => ({ status: "not_found" as const, id }),
      },
    }, logger);
    const options = { toolCallId: "call-read", messages: [], abortSignal: undefined, context: {} };
    expect(await tools.list_people.execute?.(nullPeopleInput, options)).toMatchObject({
      items: [{ id: "person-1", name: "Standalone Person" }],
    });
    expect(await tools.list_gig_person_relationships.execute?.({
      ...nullRelationshipsInput,
      gigIds: ["gig-1"],
      relationships: ["hiring_manager"],
    }, options)).toMatchObject({
      status: "ok",
      items: [{ id: "relation-1", gigId: "gig-1", personId: "person-1" }],
    });
  });

  test("includes every related gig reference when getting a person", async () => {
    const relationshipQueries: number[] = [];
    const tools = createGigFinderTools({
      ...reader,
      people: {
        ...reader.people,
        read: id => id === personRecord.id
          ? { status: "ok" as const, record: personRecord }
          : { status: "not_found" as const, id },
      },
      gigPeople: {
        ...reader.gigPeople,
        query: input => {
          relationshipQueries.push(input.offset ?? 0);
          const secondPage = input.offset === 1;
          return {
            status: "ok" as const,
            items: [{
              id: secondPage ? "relationship-2" : "relationship-1",
              gigId: secondPage ? "gig-2" : "gig-1",
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

    const result = await tools.get_person.execute?.(
      { id: "person-1" },
      { toolCallId: "call-person", messages: [], abortSignal: undefined, context: {} },
    );

    expect(result).toMatchObject({
      status: "ok",
      record: {
        id: "person-1",
        gigs: [
          { gigId: "gig-1", relationship: "hiring_manager" },
          { gigId: "gig-2", relationship: "former_peer" },
        ],
      },
    });
    expect(relationshipQueries).toEqual([0, 1]);
  });

  test("reads meetings with participant, gig, date, status, and text filters", async () => {
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
      gigId: "gig-1",
      personIds: ["person-1", "person-2"],
      externalCalendarId: null,
      externalEventId: null,
      revision: 1,
      isDeleted: false,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-30T12:00:00.000Z",
    };
    const inputs: unknown[] = [];
    const tools = createGigFinderTools({
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
      gigIds: ["gig-1"],
      statuses: ["completed"] as Array<"confirmed" | "completed">,
      startsFrom: "2026-07-01T00:00:00-07:00",
      startsThrough: "2026-07-31T23:59:59-07:00",
      query: "platform",
      offset: 0,
      limit: 10,
    };
    expect(await tools.list_meetings.execute?.(input, options)).toMatchObject({
      status: "ok",
      items: [{ id: "meeting-1", personIds: ["person-1", "person-2"], gigId: "gig-1" }],
    });
    expect(inputs).toEqual([input]);
    expect(logEntries[0]).toMatchObject({
      event: "agent.tool.started",
      toolName: "list_meetings",
      appliedFilters: {
        personIds: ["person-1", "person-2"],
        gigIds: ["gig-1"],
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
    const tools = createGigFinderTools(
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
            gigs: [],
            people: [],
            truncated: false,
          }),
        },
        stagedDocuments,
      },
    );
    expect(Object.keys(tools)).toContain("search_gigs_and_people");
    expect(Object.keys(tools)).not.toContain("get_staged_document");
    expect(Object.keys(tools)).not.toContain("create_uploaded_document");
    const stagedRead = await tools.get_document.execute?.({
      reference: staged.reference,
      version: null,
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

    const stagedToolInput: z.infer<typeof gigFinderToolSchemas.create_document> = {
      links: [{ entityType: "gig", entityId: "gig-1" }],
      documentType: "job_description",
      title: "Director role",
      description: null,
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
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
      changes: [
        { operation: "set", field: "stage", value: "applied" },
        { operation: "set", field: "fit.rating", value: "strong" },
      ],
    }).success).toBe(true);
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
      changes: [{ operation: "set", field: "id", value: "different" }],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_person.safeParse({
      id: "person-1",
      changes: [{ operation: "set", field: "status", value: "awaiting_response" }],
    }).success).toBe(true);
    expect(gigFinderToolSchemas.update_person.safeParse({
      id: "person-1",
      changes: [{ operation: "set", field: "updatedAt", value: "2026-07-27" }],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_meeting.safeParse({
      id: "meeting-1",
      changes: [
        { operation: "set", field: "status", value: "completed" },
        { operation: "set", field: "personIds", value: ["person-1"] },
        { operation: "clear", field: "location", value: null },
      ],
    }).success).toBe(true);
    expect(gigFinderToolSchemas.update_meeting.safeParse({
      id: "meeting-1",
      changes: [{ operation: "set", field: "externalEventId", value: "event" }],
    }).success).toBe(false);
  });

  test("uses a strict meeting creation schema with nullable optional values", () => {
    const input = {
      title: "Coffee",
      startsAt: "2026-07-31T08:00:00-07:00",
      endsAt: "2026-07-31T09:00:00-07:00",
      timezone: "America/Los_Angeles",
      status: "completed" as const,
      personIds: ["person-1"],
      gigId: null,
      location: null,
      description: null,
    };
    expect(gigFinderToolSchemas.create_meeting.parse(input)).toEqual(input);
    expect(gigFinderToolSchemas.create_meeting.safeParse({
      ...input,
      personIds: ["person-1", "person-1"],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.create_meeting.safeParse({
      ...input,
      timezone: "Mars/Olympus",
    }).success).toBe(false);
    const jsonSchema = z.toJSONSchema(gigFinderToolSchemas.create_meeting);
    expect(jsonSchema.required?.sort()).toEqual(
      Object.keys(jsonSchema.properties ?? {}).sort(),
    );
  });

  test("uses strict task schemas with domain enum values", () => {
    const input = {
      title: "Follow up",
      type: "networking_follow_up" as const,
      priority: null,
      dueDate: "2026-08-05",
      relatedEntity: { type: "person" as const, id: "person-1" },
      notes: null,
    };
    expect(gigFinderToolSchemas.create_task.parse(input)).toEqual(input);
    expect(gigFinderToolSchemas.create_task.safeParse({
      ...input,
      relatedEntity: { type: "general", id: "person-1" },
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_task.parse({
      id: "task-1",
      changes: [
        { operation: "set", field: "status", value: "completed" },
        { operation: "clear", field: "dueDate", value: null },
      ],
    }).changes).toHaveLength(2);
    expect(gigFinderToolSchemas.update_task.safeParse({
      id: "task-1",
      changes: [{ operation: "clear", field: "status", value: null }],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_task.safeParse({
      id: "task-1",
      changes: [{ operation: "set", field: "createdAt", value: "2026-08-05" }],
    }).success).toBe(false);
  });

  test("uses strict document schemas with domain enum values", () => {
    expect(gigFinderToolSchemas.create_document.parse({
      links: [{ entityType: "profile", entityId: "candidate" }],
      documentType: "interview_prep",
      title: "Interview stories",
      description: "Behavioral examples for interview preparation.",
      sourceKind: "inline_content",
      content: "# Interview stories",
      reference: null,
      mediaType: "text/markdown",
      sourceDescription: null,
    })).toMatchObject({
      links: [{ entityType: "profile", entityId: "candidate" }],
      title: "Interview stories",
      description: "Behavioral examples for interview preparation.",
    });
    expect(gigFinderToolSchemas.create_document.parse({
      links: [{ entityType: "gig", entityId: "gig-1" }],
      documentType: "job_description",
      title: "Job description",
      description: null,
      sourceKind: "inline_content",
      content: "Supplied source text",
      reference: null,
      mediaType: "text/plain",
      sourceDescription: null,
    })).toMatchObject({
      links: [{ entityType: "gig", entityId: "gig-1" }],
      documentType: "job_description",
      sourceKind: "inline_content",
      mediaType: "text/plain",
    });
    expect(gigFinderToolSchemas.create_document.safeParse({
      links: [{ entityType: "company", entityId: "company-1" }],
      documentType: "job_description",
      title: "Job description",
      description: null,
      sourceKind: "inline_content",
      content: "Supplied source text",
      reference: null,
      mediaType: "text/plain",
      sourceDescription: null,
    }).success).toBe(false);
    expect(gigFinderToolSchemas.create_document.safeParse({
      links: [{ entityType: "gig", entityId: "gig-1" }],
      documentType: "job_description",
      title: "Job description",
      description: null,
      sourceKind: "staged_document",
      content: "Opaque references cannot be stored as content.",
      reference: "staged-document:11111111-1111-4111-8111-111111111111",
      mediaType: "text/markdown",
      sourceDescription: null,
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_document.safeParse({
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
    const tools = createGigFinderTools(
      reader,
      logger,
      {
        gigs: { update: () => { throw new Error("not executed"); } },
        people: { update: () => { throw new Error("not executed"); } },
        tasks: taskMutations,
        meetings: meetingMutations,
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
        links: [{ entityType: "gig", entityId: "gig-1" }],
        documentType: "job_description",
        title: "Job description",
        description: null,
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
        links: [{ entityType: "gig", entityId: "gig-1" }],
        documentType: "job_description",
        title: "Job description",
        description: null,
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

  test("redacts Profile document descriptions from every tool log outcome", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: (entry: Record<string, unknown>) => entries.push(entry),
      error: (entry: Record<string, unknown>) => entries.push(entry),
    } as unknown as Logger;
    const privateDescription = "Private details about the candidate's background";
    const input = {
      links: [{ entityType: "profile" as const, entityId: "candidate" }],
      documentType: "notes" as const,
      title: "Candidate context",
      description: privateDescription,
      sourceKind: "inline_content" as const,
      content: "Private document content",
      reference: null,
      mediaType: "text/markdown" as const,
      sourceDescription: "Private source description",
    };
    const baseMutations = {
      gigs: { update: () => { throw new Error("not executed"); } },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: () => { throw new Error("not executed"); } },
    };
    const successfulTools = createGigFinderTools(reader, capturingLogger, {
      ...baseMutations,
      documents: {
        create: context => ({
          document: managedDocument,
          changeId: context.changeId ?? null,
          changed: true,
        }),
        update: () => { throw new Error("not executed"); },
      },
    }, { actor: "Candidate", requestId: "request-log-success" });
    const failingTools = createGigFinderTools(reader, capturingLogger, {
      ...baseMutations,
      documents: {
        create: () => { throw new Error("simulated failure"); },
        update: () => { throw new Error("not executed"); },
      },
    }, { actor: "Candidate", requestId: "request-log-failure" });
    if (!("create_document" in successfulTools) || !("create_document" in failingTools)) {
      throw new Error("Document mutation tools were not registered.");
    }

    await successfulTools.create_document.execute?.(
      input,
      { toolCallId: "document-success", messages: [], abortSignal: undefined, context: {} },
    );
    await failingTools.create_document.execute?.(
      input,
      { toolCallId: "document-failure", messages: [], abortSignal: undefined, context: {} },
    );

    expect(entries.map(entry => entry.event)).toEqual([
      "agent.tool.started",
      "agent.tool.completed",
      "agent.tool.started",
      "agent.tool.failed",
    ]);
    expect(JSON.stringify(entries)).not.toContain(privateDescription);
  });

  test("updates documents by exact ID and expected version", async () => {
    let received:
      | { context: ChangeContext; input: unknown }
      | undefined;
    const tools = createGigFinderTools(
      reader,
      logger,
      {
        gigs: { update: () => { throw new Error("not executed"); } },
        people: { update: () => { throw new Error("not executed"); } },
        tasks: taskMutations,
        meetings: meetingMutations,
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
    const gigSchema = z.toJSONSchema(gigFinderToolSchemas.update_gig);
    const contactSchema = z.toJSONSchema(
      gigFinderToolSchemas.update_person,
    );
    const meetingSchema = z.toJSONSchema(gigFinderToolSchemas.update_meeting);
    const taskSchema = z.toJSONSchema(gigFinderToolSchemas.update_task);
    const descriptions = JSON.stringify({ gigSchema, contactSchema, meetingSchema, taskSchema });
    for (const value of [
      ...pipelineStages,
      ...fitRatings,
      ...personStatuses,
      ...meetingStatuses,
      ...taskTypes,
      ...taskStatuses,
      ...taskPriorities,
    ]) {
      expect(descriptions).toContain(value);
    }
  });

  test("leaves field-value compatibility to the core update contract", async () => {
    let called = false;
    const tools = createGigFinderTools(
      reader,
      logger,
      {
        gigs: { update: () => {
          called = true;
          throw new Error("not expected");
        } },
        people: { update: () => { throw new Error("not executed"); } },
        tasks: taskMutations,
        meetings: meetingMutations,
        changes: { revert: () => { throw new Error("not executed"); } },
        documents: documentMutations,
      },
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_gig.execute?.(
      {
        id: "gig-1",
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
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
      changes: [{ operation: "clear", field: "nextAction", value: null }],
    }).success).toBe(true);
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
      changes: [{ operation: "clear", field: "stage", value: null }],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
      changes: [{ operation: "clear", field: "sourceUrl", value: "wrong" }],
    }).success).toBe(false);
    expect(gigFinderToolSchemas.update_gig.safeParse({
      id: "gig-1",
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
    const record: Gig = {
      id: "gig-1",
      company: "Company",
      title: "Director",
      externalJobId: null,
      artifactDirectory: null,
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
    const capturingMutations: GigFinderMutationCapabilities = {
      gigs: { update: (context, id, patch) => {
        received = { context, id, patch };
        return {
          changeId: context.changeId ?? null,
          record,
        };
      } },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createGigFinderTools(
      reader,
      logger,
      capturingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");

    const result = await tools.update_gig.execute?.(
      {
        id: "gig-1",
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
        summary: "Agent updated gig gig-1 (request request-1, tool call-9)",
        changeId: "agent-tool:call-9",
      },
      id: "gig-1",
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

  test("adapts shared creation and document discovery capabilities", async () => {
    const created: Array<{kind:string;id:string;changeId?:string}> = [];
    const capabilities: GigFinderMutationCapabilities = {
      gigs:{createNew:((context:ChangeContext,id:string,input:object)=>{created.push({kind:"gig",id,changeId:context.changeId});return{changeId:context.changeId??null,record:{id,...input}}}) as never,update:()=>{throw new Error("not executed")}},
      people:{createNew:((context:ChangeContext,id:string,input:object)=>{created.push({kind:"person",id,changeId:context.changeId});return{changeId:context.changeId??null,record:{id,...input}}}) as never,update:()=>{throw new Error("not executed")}},
      gigPeople:{createNew:((context:ChangeContext,id:string,input:object)=>{created.push({kind:"relationship",id,changeId:context.changeId});return{changeId:context.changeId??null,record:{id,...input}}}) as never},
      tasks:taskMutations,meetings:meetingMutations,changes:{revert:()=>{throw new Error("not executed")}},documents:documentMutations,
    };
    const discoveryReader: GigFinderReadCapabilities={...reader,documents:{...reader.documents,
      query:async input=>({status:"ok",items:[],page:{offset:input.offset??0,limit:input.limit??20,returned:0,total:0,hasMore:false,nextOffset:null}}),
      versionQuery:input=>({status:"unsupported",id:input.documentId,message:"Only managed documents have version history."}),
    }};
    const tools=createGigFinderTools(discoveryReader,logger,capabilities,{actor:"Candidate",requestId:"request-creation"});
    if(!("create_gig" in tools)||!tools.create_gig)throw new Error("Create gig tool was not registered.");const createGig=tools.create_gig;
    const gigInput={company:"Example",title:"Director",externalJobId:null,stage:"identified" as const,outcome:"pending" as const,statusSummary:"Identified",lastActivity:"2026-08-05",nextAction:null,fit:{rating:"good" as const,summary:null},payRange:null,sourceUrl:null,tags:[],location:null,workArrangement:null,postedDate:null,businessUnitTeam:null,recruiterSource:null,bonus:null,equity:null,otherCompensation:null};
    const output=await createGig.execute?.(gigInput,{toolCallId:"create-1",messages:[],abortSignal:undefined,context:{}});
    expect(output).toMatchObject({status:"ok",changeId:"agent-tool:create-1",record:{company:"Example"}});
    expect(created[0]).toMatchObject({kind:"gig",id:expect.stringMatching(/^gig_/),changeId:"agent-tool:create-1"});
    expect(await tools.list_documents.execute?.({owner:{entityType:"profile",entityId:"candidate"},offset:null,limit:null},{toolCallId:"read-1",messages:[],abortSignal:undefined,context:{}})).toMatchObject({status:"ok",page:{limit:20}});
    expect(await tools.list_document_versions.execute?.({documentId:"gig:gig:job_description",offset:null,limit:null},{toolCallId:"read-2",messages:[],abortSignal:undefined,context:{}})).toMatchObject({status:"unsupported"});
  });

  test("creates and updates tasks through the shared mutation boundary", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const taskLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    let created: {
      context: ChangeContext;
      input: Parameters<GigFinderMutationCapabilities["tasks"]["createNew"]>[1];
    } | undefined;
    let updated: { context: ChangeContext; id: string; patch: unknown } | undefined;
    const taskRecord = (input: Parameters<GigFinderMutationCapabilities["tasks"]["createNew"]>[1]): TaskRecord => ({
      id: input.id,
      title: input.title!,
      type: input.type!,
      status: "open",
      priority: input.priority ?? "medium",
      dueDate: input.dueDate??null,
      relatedEntity: { ...input.relatedEntity!, label: "Contact Person" },
      notes: input.notes??null,
      createdAt: "2026-08-03",
      updatedAt: "2026-08-03",
      completedAt: null,
    });
    const tools = createGigFinderTools(
      reader,
      taskLogger,
      {
        ...mutations,
        tasks: {
          createNew: (context, input) => {
            created = { context, input };
            return { changeId: context.changeId ?? null, record: taskRecord(input) };
          },
          update: (context, id, patch) => {
            updated = { context, id, patch };
            return {
              changeId: context.changeId ?? null,
              record: {
                ...taskRecord({
                  id,
                  title: "Private follow-up",
                  type: "networking_follow_up",
                  dueDate: null,
                  relatedEntity: { type: "person", id: "person-1" },
                  notes: null,
                }),
                status: "completed",
                completedAt: "2026-08-03",
              },
            };
          },
        },
      },
      { actor: "Candidate", requestId: "request-task" },
    );
    if (!("create_task" in tools) || !("update_task" in tools)) {
      throw new Error("Task mutation tools were not registered.");
    }

    const createdResult = await tools.create_task.execute?.({
      title: "Private follow-up",
      type: "networking_follow_up",
      priority: null,
      dueDate: "2026-08-05",
      relatedEntity: { type: "person", id: "person-1" },
      notes: "Private task notes",
    }, { toolCallId: "call-create-task", messages: [], abortSignal: undefined, context: {} });

    expect(created?.context).toEqual({
      actor: "Candidate",
      source: "agent",
      summary: "Agent created task (request request-task, tool call-create-task)",
      changeId: "agent-tool:call-create-task",
    });
    expect(created?.input.id).toMatch(/^task_[0-9a-f-]{36}$/);
    expect(createdResult).toMatchObject({
      status: "ok",
      changeId: "agent-tool:call-create-task",
    });

    await tools.update_task.execute?.({
      id: created!.input.id,
      changes: [
        { operation: "set", field: "status", value: "completed" },
        { operation: "clear", field: "dueDate", value: null },
        { operation: "set", field: "relatedEntity", value: { type: "gig", id: "gig-1" } },
      ],
    }, { toolCallId: "call-update-task", messages: [], abortSignal: undefined, context: {} });

    expect(updated).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: `Agent updated task ${created!.input.id} (request request-task, tool call-update-task)`,
        changeId: "agent-tool:call-update-task",
      },
      id: created!.input.id,
      patch: {
        status: "completed",
        dueDate: null,
        relatedEntity: { type: "gig", id: "gig-1" },
      },
    });
    expect(entries[0]).toMatchObject({
      toolName: "create_task",
      relatedEntity: { type: "person", id: "person-1" },
      appliedFilters: {},
    });
    expect(JSON.stringify(entries)).not.toContain("Private follow-up");
    expect(JSON.stringify(entries)).not.toContain("Private task notes");
  });

  test("creates and updates meetings through the shared mutation boundary", async () => {
    const entries: Array<Record<string, unknown>> = [];
    const meetingLogger = {
      debug: (entry: Record<string, unknown>) => entries.push(entry),
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    let created: { context: ChangeContext; meeting: MeetingRecord } | undefined;
    let updated: { context: ChangeContext; id: string; patch: unknown } | undefined;
    const record = (input: Omit<MeetingRecord, "revision" | "isDeleted" | "createdAt" | "updatedAt">): MeetingRecord => ({
      ...input,
      revision: 1,
      isDeleted: false,
      createdAt: "2026-07-31T15:00:00.000Z",
      updatedAt: "2026-07-31T15:00:00.000Z",
    });
    const tools = createGigFinderTools(
      reader,
      meetingLogger,
      {
        ...mutations,
        meetings: {
          create: (context, input) => {
            const persisted = record(input);
            created = { context, meeting: persisted };
            return { changeId: context.changeId ?? null, record: persisted };
          },
          update: (context, id, patch) => {
            updated = { context, id, patch };
            return {
              changeId: context.changeId ?? null,
              record: record({
                id,
                title: "Coffee",
                startsAt: "2026-07-31T08:00:00-07:00",
                endsAt: "2026-07-31T09:00:00-07:00",
                timezone: "America/Los_Angeles",
                status: "completed",
                personIds: ["person-1", "person-2"],
                gigId: null,
                location: null,
                description: "Discussed the role",
                externalCalendarId: null,
                externalEventId: null,
              }),
            };
          },
        },
      },
      { actor: "Candidate", requestId: "request-meeting" },
    );
    if (!("create_meeting" in tools) || !("update_meeting" in tools)) {
      throw new Error("Meeting mutation tools were not registered.");
    }

    const createdResult = await tools.create_meeting.execute?.({
      title: "Private meeting title",
      startsAt: "2026-07-31T08:00:00-07:00",
      endsAt: "2026-07-31T09:00:00-07:00",
      timezone: "America/Los_Angeles",
      status: "confirmed",
      personIds: ["person-1"],
      gigId: null,
      location: "Private location",
      description: "Private meeting description",
    }, { toolCallId: "call-create-meeting", messages: [], abortSignal: undefined, context: {} });

    expect(created?.context).toEqual({
      actor: "Candidate",
      source: "agent",
      summary: "Agent created meeting (request request-meeting, tool call-create-meeting)",
      changeId: "agent-tool:call-create-meeting",
    });
    expect(created?.meeting).toMatchObject({
      id: expect.stringMatching(/^meeting_[0-9a-f-]{36}$/),
      personIds: ["person-1"],
      externalCalendarId: null,
      externalEventId: null,
    });
    expect(createdResult).toMatchObject({
      status: "ok",
      changeId: "agent-tool:call-create-meeting",
    });

    await tools.update_meeting.execute?.({
      id: created!.meeting.id,
      changes: [
        { operation: "set", field: "status", value: "completed" },
        { operation: "set", field: "personIds", value: ["person-1", "person-2"] },
        { operation: "clear", field: "location", value: null },
      ],
    }, { toolCallId: "call-update-meeting", messages: [], abortSignal: undefined, context: {} });

    expect(updated).toEqual({
      context: {
        actor: "Candidate",
        source: "agent",
        summary: `Agent updated meeting ${created!.meeting.id} (request request-meeting, tool call-update-meeting)`,
        changeId: "agent-tool:call-update-meeting",
      },
      id: created!.meeting.id,
      patch: {
        status: "completed",
        personIds: ["person-1", "person-2"],
        location: null,
      },
    });
    expect(entries[0]).toMatchObject({
      toolName: "create_meeting",
      participantIds: ["person-1"],
      appliedFilters: {},
    });
    expect(JSON.stringify(entries)).not.toContain("Private meeting title");
    expect(JSON.stringify(entries)).not.toContain("Private location");
    expect(JSON.stringify(entries)).not.toContain("Private meeting description");
  });

  test("returns a structured duplicate result", async () => {
    const duplicateMutations: GigFinderMutationCapabilities = {
      gigs: { update: () => {
        throw new MutationError("duplicate_change", "Already applied");
      } },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createGigFinderTools(
      reader,
      logger,
      duplicateMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_gig.execute?.(
      {
        id: "gig-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-9", messages: [], abortSignal: undefined, context: {} },
    )).toEqual({
      status: "error",
      error: "duplicate_change",
      message: "Already applied",
    });
  });

  test("returns a structured persistence consistency failure", async () => {
    const tools = createGigFinderTools({
      ...reader,
      documents: {
        list: async () => [],
        get: async () => {
          throw new PersistenceConsistencyError("Document link is inconsistent.");
        },
      },
    }, logger);

    expect(await tools.get_document.execute?.(
      { reference: managedDocument.id, version: null },
      { toolCallId: "call-inconsistent-document", messages: [], abortSignal: undefined, context: {} },
    )).toEqual({
      status: "error",
      error: "consistency_error",
      message: "Document link is inconsistent.",
    });
  });

  test("returns a structured revision-conflict result", async () => {
    const conflictingMutations: GigFinderMutationCapabilities = {
      gigs: { update: () => {
        throw new MutationError(
          "revision_conflict",
          "Gig gig-1 was updated concurrently.",
        );
      } },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createGigFinderTools(
      reader,
      logger,
      conflictingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");

    expect(await tools.update_gig.execute?.(
      {
        id: "gig-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-9", messages: [], abortSignal: undefined, context: {} },
    )).toEqual({
      status: "error",
      error: "revision_conflict",
      message: "Gig gig-1 was updated concurrently.",
    });
  });

  test("passes any exact change ID through the generic revert tool", async () => {
    let received: { context: ChangeContext; targetChangeId: string } | undefined;
    const capturingMutations: GigFinderMutationCapabilities = {
      gigs: { update: () => { throw new Error("not executed"); } },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: (context, targetChangeId) => {
        received = { context, targetChangeId };
        return {
          changeId: context.changeId ?? "generated",
          revertedChangeId: targetChangeId,
          affected: [{ entity: "gig", id: "gig-1" }],
        };
      } },
      documents: documentMutations,
    };
    const tools = createGigFinderTools(
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
      id: "gig-1",
      company: "Company",
      title: "Director",
      externalJobId: null,
      artifactDirectory: null,
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
      hasJobDescription: false,
      hasInterviewPrep: false,
    } satisfies Gig;
    const loggingMutations: GigFinderMutationCapabilities = {
      gigs: { update: context => ({
        changeId: context.changeId ?? null,
        record,
      }) },
      people: { update: () => { throw new Error("not executed"); } },
      tasks: taskMutations,
      meetings: meetingMutations,
      changes: { revert: () => { throw new Error("not executed"); } },
      documents: documentMutations,
    };
    const tools = createGigFinderTools(
      reader,
      capturingLogger,
      loggingMutations,
      { actor: "Candidate", requestId: "request-1" },
    );
    if (!("update_gig" in tools)) throw new Error("Mutation tools were not registered.");

    await tools.update_gig.execute?.(
      {
        id: "gig-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      { toolCallId: "call-log", messages: [], abortSignal: undefined, context: {} },
    );

    expect(entries[0]).toMatchObject({
      event: "agent.tool.started",
      recordId: "gig-1",
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
    expect(gigFinderToolSchemas.list_gigs.parse({
      ...nullGigsInput,
      stages: [...pipelineStages],
      fitRatings: [...fitRatings],
    })).toMatchObject({ stages: [...pipelineStages], fitRatings: [...fitRatings] });
    expect(gigFinderToolSchemas.list_people.parse({
      ...nullPeopleInput,
      statuses: [...personStatuses],
    }).statuses).toEqual([...personStatuses]);
    expect(gigFinderToolSchemas.list_tasks.parse({
      ...nullTasksInput,
      types: [...taskTypes],
    }).types).toEqual([...taskTypes]);
    expect(gigFinderToolSchemas.list_gig_person_relationships.parse({
      ...nullRelationshipsInput,
      relationships: [...gigPersonRelationships],
    }).relationships).toEqual([...gigPersonRelationships]);
    expect(gigFinderToolSchemas.list_meetings.parse({
      ...nullMeetingsInput,
      statuses: [...meetingStatuses],
    }).statuses).toEqual([...meetingStatuses]);
  });

  test("rejects unknown fields, invalid enums, empty arrays, and pagination outside bounds", () => {
    expect(gigFinderToolSchemas.list_gigs.safeParse({ ...nullGigsInput, stages: [] }).success).toBe(false);
    expect(gigFinderToolSchemas.list_gigs.safeParse({ ...nullGigsInput, stages: ["invalid"] }).success).toBe(false);
    expect(gigFinderToolSchemas.list_gigs.safeParse({ ...nullGigsInput, limit: 51 }).success).toBe(false);
    expect(gigFinderToolSchemas.list_tasks.safeParse({ ...nullTasksInput, offset: -1 }).success).toBe(false);
    expect(gigFinderToolSchemas.list_people.safeParse({
      ...nullPeopleInput,
      unexpected: true,
    }).success).toBe(false);
  });

  test("communicates all enum values in model-facing JSON Schema", () => {
    const schemas = JSON.stringify({
      gigs: z.toJSONSchema(gigFinderToolSchemas.list_gigs),
      people: z.toJSONSchema(gigFinderToolSchemas.list_people),
      tasks: z.toJSONSchema(gigFinderToolSchemas.list_tasks),
      relationships: z.toJSONSchema(gigFinderToolSchemas.list_gig_person_relationships),
      meetings: z.toJSONSchema(gigFinderToolSchemas.list_meetings),
    });
    for (const value of [...pipelineStages, ...fitRatings, ...personStatuses, ...taskTypes, ...gigPersonRelationships, ...meetingStatuses]) {
      expect(schemas).toContain(`"${value}"`);
    }
  });

  test("describes every parameter in model-facing JSON Schema", () => {
    for (const schema of Object.values(gigFinderToolSchemas)) {
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
      [gigFinderToolSchemas.list_gigs, nullGigsInput],
      [gigFinderToolSchemas.list_people, nullPeopleInput],
      [gigFinderToolSchemas.list_tasks, nullTasksInput],
      [gigFinderToolSchemas.list_gig_person_relationships, nullRelationshipsInput],
      [gigFinderToolSchemas.list_meetings, nullMeetingsInput],
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

  test("generates strict-compatible schemas for the complete registry", () => {
    for (const [name, schema] of Object.entries(gigFinderToolSchemas)) {
      expect(() => validateStrictToolJsonSchema(name, z.toJSONSchema(schema)))
        .not.toThrow();
    }
  });

  test("does not emit provider-unsupported URI formats", () => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const schema = node as Record<string, unknown>;
      expect(schema.format).not.toBe("uri");
      Object.values(schema).forEach(visit);
    };
    for (const schema of Object.values(gigFinderToolSchemas)) {
      visit(z.toJSONSchema(schema));
    }
  });

  test("keeps create_gig nested values strict while adapting optional domain fields", () => {
    const jsonSchema = z.toJSONSchema(gigFinderToolSchemas.create_gig);
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
    const nextActionSchema = properties.nextAction;
    expect(nextActionSchema).toBeDefined();
    const nextAction = (nextActionSchema?.anyOf as Array<Record<string, unknown>>)
      .find(branch => branch.type === "object");
    expect(nextAction).toMatchObject({
      additionalProperties: false,
      required: ["description", "due"],
    });
    expect(jsonSchema.required).toContain("nextAction");
    expect(gigInputSchema.safeParse({
      company: "Synthetic Co",
      title: "Engineering Director",
    }).success).toBe(true);
    expect(gigFinderToolSchemas.create_gig.safeParse({
      company: "Synthetic Co",
      title: "Engineering Director",
    }).success).toBe(false);
  });

  test("leaves URL validation at the domain boundary without emitting URI formats", () => {
    const completeGig = {
      company: "Synthetic Co",
      title: "Engineering Director",
      externalJobId: null,
      stage: "identified" as const,
      outcome: "pending" as const,
      statusSummary: "Identified",
      lastActivity: "2026-08-05",
      nextAction: null,
      fit: { rating: "good" as const, summary: null },
      payRange: null,
      sourceUrl: "not a URL",
      tags: [],
      location: null,
      workArrangement: null,
      postedDate: null,
      businessUnitTeam: null,
      recruiterSource: null,
      bonus: null,
      equity: null,
      otherCompensation: null,
    };
    expect(gigFinderToolSchemas.create_gig.safeParse(completeGig).success).toBe(true);
    expect(gigInputSchema.safeParse(completeGig).success).toBe(false);
  });

  test("generates a Codex-compatible flat document source schema", () => {
    const jsonSchema = z.toJSONSchema(gigFinderToolSchemas.create_document);
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
    const tools = createGigFinderTools(reader, capturingLogger);

    await tools.list_gigs.execute?.(
      {
        ...nullGigsInput,
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
    const tools = createGigFinderTools(reader, capturingLogger);

    await tools.list_gigs.execute?.(
      { ...nullGigsInput, overdueOnly: false, offset: 0, limit: 20 },
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
    const tools = createGigFinderTools(reader, capturingLogger);

    await tools.get_gig.execute?.(
      { id: "missing-gig" },
      { toolCallId: "call-3", messages: [], abortSignal: undefined, context: {} },
    );

    expect(debugEntries).toHaveLength(1);
    expect(warningEntries).toHaveLength(1);
    expect(warningEntries[0]).toMatchObject({
      event: "agent.tool.completed",
      toolName: "get_gig",
      toolCallId: "call-3",
      recordId: "missing-gig",
      outcome: "not_found",
    });
  });
});
