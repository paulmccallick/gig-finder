import { describe, expect, test } from "bun:test";
import { simulateReadableStream, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { Logger } from "pino";
import type {
  ChangeContext,
  GigRecord,
  ManagedDocumentRecord,
  MeetingRecord,
  TaskRecord,
} from "../../core/src";
import { StagedDocumentService } from "../../core/src";
import { GigFinderAgent } from "../gig-finder-agent";
import {
  createGigFinderTools,
  type GigFinderReadCapabilities,
  type GigFinderMutationCapabilities,
} from "../gig-finder-tools";
import { testCandidateProfile } from "./fixtures";
import {
  buildGigFinderInstructions,
  genericGigFinderAgentSystemPrompt,
  gigFinderDocumentInstructions,
} from "../system-prompt";

const userMessage = (text: string): ModelMessage => ({
  role: "user",
  content: text,
});

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 8, text: 8, reasoning: undefined },
};

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function readerWithGigs(items: GigRecord[]): GigFinderReadCapabilities {
  return {
    gigs: { query: input => ({
      items,
      page: {
        offset: input.offset ?? 0,
        limit: input.limit ?? 20,
        returned: items.length,
        total: items.length,
        hasMore: false,
        nextOffset: null,
      },
    }), read: id => ({ status: "not_found" as const, id }) },
    people: {
      query: input => ({ items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
      read: id => ({ status: "not_found" as const, id }),
    },
    gigPeople: {
      query: input => ({ status: "ok" as const, items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
      read: id => ({ status: "not_found" as const, id }),
    },
    tasks: { query: input => ({
      items: [],
      page: {
        offset: input.offset ?? 0,
        limit: input.limit ?? 20,
        returned: 0,
        total: 0,
        hasMore: false,
        nextOffset: null,
      },
    }), read: id => ({ status: "not_found" as const, id }) },
    meetings: {
      query: input => ({ status: "ok" as const, items: [], page: { offset: input.offset ?? 0, limit: input.limit ?? 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
      read: id => ({ status: "not_found" as const, id }),
    },
    documents: {
      list: async () => [],
      get: async reference => ({ status: "not_found" as const, id: reference }),
    },
  };
}

function gigRecord(
  input: Pick<GigRecord, "id" | "company" | "title"> & Partial<GigRecord>,
): GigRecord {
  return {
    externalJobId: null,
    artifactDirectory: null,
    stage: "identified",
    outcome: "pending",
    statusSummary: "Considering",
    lastActivity: "2026-07-28",
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
    documents: [],
    ...input,
  };
}

function documentMutations(
  create: GigFinderMutationCapabilities["documents"]["create"],
): GigFinderMutationCapabilities {
  return {
    gigs: { update: () => { throw new Error("not executed"); } },
    people: { update: () => { throw new Error("not executed"); } },
    tasks: {
      createNew: () => { throw new Error("not executed"); },
      update: () => { throw new Error("not executed"); },
    },
    meetings: {
      create: () => { throw new Error("not executed"); },
      update: () => { throw new Error("not executed"); },
    },
    changes: { revert: () => { throw new Error("not executed"); } },
    documents: {
      create,
      update: () => { throw new Error("not executed"); },
    },
  };
}

function mockModel(answer = "Prioritize roles with matching leadership scope.") {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: answer },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 8, text: 8, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

describe("GigFinderAgent instructions", () => {
  test("keeps the generic policy independent of a particular search", () => {
    expect(genericGigFinderAgentSystemPrompt).toContain("You are GigFinderAgent");
    expect(genericGigFinderAgentSystemPrompt).not.toContain("Jordan");
    expect(genericGigFinderAgentSystemPrompt).not.toContain("Consumer services");
    expect(genericGigFinderAgentSystemPrompt).not.toContain("Senior Director");
  });

  test("states the configured live-data boundary", () => {
    expect(buildGigFinderInstructions(testCandidateProfile)).toContain(
      "no access to live pipeline records",
    );
    expect(buildGigFinderInstructions(testCandidateProfile, {
      liveRecords: true,
    })).toContain("These tools are read-only");
    const writableInstructions = buildGigFinderInstructions(testCandidateProfile, {
      liveRecords: true,
      canUpdateRecords: true,
    });
    expect(writableInstructions).toContain(
      "Person: an individual with identity, relationship, priority, status, outreach, notes, tags, and documents",
    );
    expect(writableInstructions).toContain(
      "Gig-Person Relationship: a connection between a Person and a Gig",
    );
    expect(writableInstructions).toContain(
      "Meeting: a scheduled or completed interaction with one or more People",
    );
    expect(writableInstructions).toContain(
      "Use the tools to find relevant information for the user request and update information when appropriate or told to do so.",
    );
    expect(writableInstructions).toContain(
      "Always verify with the user before creating updates.",
    );
    expect(writableInstructions).not.toContain("dashboard");
    expect(gigFinderDocumentInstructions.trim().split(/\s+/).length).toBeLessThanOrEqual(100);
  });

  test("composes the current user's profile separately", () => {
    const instructions = buildGigFinderInstructions(testCandidateProfile);
    expect(instructions).toContain("You are GigFinderAgent");
    expect(instructions).toContain("Preferred name: Jordan");
    expect(instructions).toContain("Profession: Product and operations leadership");
    expect(instructions).toContain("Experience level: Experienced people leader");
    expect(instructions).toContain("More than ten years");
    expect(instructions).toContain("Consumer services");
    expect(instructions).toContain("Director of Product");
    expect(instructions).toContain("Hybrid");
    expect(instructions).toContain("Individual-contributor roles");
  });

  test("loads Profile document descriptions without loading document contents", () => {
    const instructions = buildGigFinderInstructions(testCandidateProfile, {
      liveRecords: true,
      profileDocuments: [{
        id: "doc_11111111-1111-4111-8111-111111111111",
        name: "Interview stories",
        type: "interview_prep",
        description: "Behavioral examples from prior leadership roles.",
        currentVersion: 3,
      }],
    });

    expect(instructions).toContain(
      "Interview stories [doc_11111111-1111-4111-8111-111111111111] (interview_prep, version 3): Behavioral examples from prior leadership roles.",
    );
    expect(instructions).toContain("Use get_document with the exact ID");
    expect(instructions).not.toContain("Confidential story content");
  });
});

describe("agent streaming", () => {
  test("streams UI messages without registering tools", async () => {
    const model = mockModel();
    const logEntries: Array<{ level: string; data: Record<string, unknown> }> = [];
    const logger = {
      debug: (data: Record<string, unknown>) => logEntries.push({ level: "debug", data }),
      info: (data: Record<string, unknown>) => logEntries.push({ level: "info", data }),
      warn: (data: Record<string, unknown>) => logEntries.push({ level: "warn", data }),
      error: (data: Record<string, unknown>) => logEntries.push({ level: "error", data }),
    } as unknown as Logger;
    const agent = new GigFinderAgent({ profile: testCandidateProfile, model, logger });
    const result = agent.respond([userMessage("What should I prioritize?")]);
    expect(await result.text).toContain("Prioritize roles with matching leadership scope.");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doStreamCalls[0]?.tools).toBeUndefined();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("What should I prioritize?");
    expect(logEntries.find(entry => entry.data.event === "model.interaction")).toMatchObject({
      level: "debug",
      data: {
      event: "model.interaction",
      messageCount: 1,
      textCharacters: 25,
      },
    });
    expect(logEntries.find(entry => entry.data.event === "agent.step.started")).toMatchObject({
      level: "debug",
      data: {
        event: "agent.step.started",
        stepNumber: 0,
        availableTools: [],
      },
    });
    expect(logEntries.find(entry => entry.data.event === "agent.step.completed")).toMatchObject({
      level: "debug",
      data: {
        event: "agent.step.completed",
        stepNumber: 0,
        usage: {
          inputTokens: 10,
          outputTokens: 8,
          totalTokens: 18,
        },
        modelOutput: {
          text: "Prioritize roles with matching leadership scope.",
          reasoning: null,
          toolCalls: [],
        },
        toolCalls: [],
        toolResults: [],
      },
    });
    const completion = logEntries.find(entry => entry.data.event === "model.interaction.finished");
    expect(completion?.data).toMatchObject({
      event: "model.interaction.finished",
      outcome: "completed",
      textCharactersGenerated: 48,
      toolCallCount: 0,
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
      },
    });
    expect(completion?.data.latencyMs).toBeNumber();
  });

  test("executes a meeting read tool and streams the model's final answer", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: "list_meetings",
                input: JSON.stringify({
                  personIds: ["person-1"],
                  gigIds: null,
                  statuses: null,
                  startsFrom: null,
                  startsThrough: null,
                  query: null,
                  offset: null,
                  limit: null,
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "You met with the recruiter." },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ],
          }),
        },
      ],
    });
    const meeting: MeetingRecord = {
      id: "meeting-1",
      title: "Recruiter screen",
      startsAt: "2026-07-23T10:00:00-07:00",
      endsAt: "2026-07-23T10:30:00-07:00",
      timezone: "America/Los_Angeles",
      location: "Video",
      description: null,
      status: "completed",
      gigId: "gig-1",
      personIds: ["person-1"],
      externalCalendarId: null,
      externalEventId: null,
      revision: 1,
      isDeleted: false,
      createdAt: "2026-07-22T12:00:00.000Z",
      updatedAt: "2026-07-23T12:00:00.000Z",
    };
    const reader = {
      ...readerWithGigs([]),
      meetings: { query: () => ({
        status: "ok" as const,
        items: [meeting],
        page: { offset: 0, limit: 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
      }), read: id => ({ status: "not_found" as const, id }) },
    } satisfies GigFinderReadCapabilities;
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools: createGigFinderTools(reader, logger),
    });

    expect(await agent.respond([userMessage("When did I meet this person?")]).text).toBe(
      "You met with the recruiter.",
    );
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.tools?.map(({ name }) => name)).toContain("list_meetings");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Recruiter screen");
  });

  test("creates a meeting and returns its result to the model", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "create-meeting",
                toolName: "create_meeting",
                input: JSON.stringify({
                  title: "Coffee with Jordan",
                  startsAt: "2026-07-31T08:00:00-07:00",
                  endsAt: "2026-07-31T09:00:00-07:00",
                  timezone: "America/Los_Angeles",
                  status: "completed",
                  personIds: ["person-jordan"],
                  gigId: null,
                  location: "Seattle",
                  description: "Discussed leadership roles",
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "Recorded your meeting with Jordan." },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ],
          }),
        },
      ],
    });
    let received: { context: ChangeContext; meeting: MeetingRecord } | undefined;
    const mutations = documentMutations(() => { throw new Error("not executed"); });
    mutations.meetings = {
      create: (context, meeting) => {
        const record: MeetingRecord = {
          ...meeting,
          revision: 1,
          isDeleted: false,
          createdAt: "2026-07-31T16:00:00.000Z",
          updatedAt: "2026-07-31T16:00:00.000Z",
        };
        received = { context, meeting: record };
        return { changeId: context.changeId ?? null, record };
      },
      update: () => { throw new Error("not executed"); },
    };
    const tools = createGigFinderTools(
      readerWithGigs([]),
      logger,
      mutations,
      { actor: "Candidate", requestId: "request-meeting" },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });

    expect(await agent.respond([
      userMessage("Record my completed coffee meeting with Jordan."),
    ]).text).toBe("Recorded your meeting with Jordan.");
    expect(received).toMatchObject({
      context: { changeId: "agent-tool:create-meeting" },
      meeting: { personIds: ["person-jordan"], status: "completed" },
    });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "agent-tool:create-meeting",
    );
  });

  test("creates a task and returns its result to the model", async () => {
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "create-task",
                toolName: "create_task",
                input: JSON.stringify({
                  title: "Follow up with Jordan",
                  type: "networking_follow_up",
                  priority: "high",
                  dueDate: "2026-08-05",
                  relatedEntity: { type: "person", id: "person-jordan" },
                  notes: null,
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "Created the follow-up task." },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ],
          }),
        },
      ],
    });
    let received: { context: ChangeContext; task: TaskRecord } | undefined;
    const mutations = documentMutations(() => { throw new Error("not executed"); });
    mutations.tasks = {
      createNew: (context, input) => {
        const task: TaskRecord = {
          ...input,
          status: "open",
          priority: input.priority ?? "medium",
          relatedEntity: { ...input.relatedEntity, label: "Jordan" },
          createdAt: "2026-08-03",
          updatedAt: "2026-08-03",
          completedAt: null,
        };
        received = { context, task };
        return { changeId: context.changeId ?? null, record: task };
      },
      update: () => { throw new Error("not executed"); },
    };
    const tools = createGigFinderTools(
      readerWithGigs([]),
      logger,
      mutations,
      { actor: "Candidate", requestId: "request-task" },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });

    expect(await agent.respond([
      userMessage("Create the follow-up task we just agreed on."),
    ]).text).toBe("Created the follow-up task.");
    expect(received).toMatchObject({
      context: { changeId: "agent-tool:create-task" },
      task: { status: "open", priority: "high", relatedEntity: { id: "person-jordan" } },
    });
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "agent-tool:create-task",
    );
  });

  test("creates a document when the user explicitly requests it", async () => {
    const gig = gigRecord({
      id: "gig-acme",
      company: "Acme",
      title: "Director of Engineering",
      stage: "identified",
      outcome: "pending",
      statusSummary: "Role shared by a contact",
      lastActivity: "2026-07-28",
      nextAction: null,
      fit: { rating: "good", summary: null },
      location: "Remote",
      workArrangement: "remote",
      documents: [],
    });
    const createdDocument: ManagedDocumentRecord = {
      id: "doc_11111111-1111-4111-8111-111111111111",
      links: [{ entityType: "gig", entityId: gig.id }],
      documentType: "job_description",
      title: "Director of Engineering job description",
      description: null,
      displayName: "Director of Engineering job description",
      mediaType: "text/plain",
      sourceDescription: "Shared by Taylor via text message",
      filePath: null,
      uploadProvenance: null,
      currentVersion: 1,
      content: "Lead the engineering organization.",
      contentHash: "content-hash",
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z",
    };
    let received:
      | {
          context: ChangeContext;
          input: Parameters<GigFinderMutationCapabilities["documents"]["create"]>[1];
        }
      | undefined;
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "find-gig",
                toolName: "list_gigs",
                input: JSON.stringify({
                  stages: null,
                  outcomes: null,
                  fitRatings: null,
                  overdueOnly: null,
                  query: "Acme",
                  offset: null,
                  limit: null,
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "create-document",
                toolName: "create_document",
                input: JSON.stringify({
                  links: [{ entityType: "gig", entityId: gig.id }],
                  documentType: "job_description",
                  title: "Director of Engineering job description",
                  description: null,
                  sourceKind: "inline_content",
                  content: "Lead the engineering organization.",
                  reference: null,
                  mediaType: "text/plain",
                  sourceDescription: "Shared by Taylor via text message",
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              {
                type: "text-delta",
                id: "text-1",
                delta: `Saved the job description to ${gig.company}.`,
              },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ],
          }),
        },
      ],
    });
    const tools = createGigFinderTools(
      readerWithGigs([gig]),
      logger,
      documentMutations((context, input) => {
        received = { context, input };
        return {
          document: createdDocument,
          changeId: context.changeId ?? null,
          changed: true,
        };
      }),
      { actor: "Candidate", requestId: "request-document" },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });

    expect(await agent.respond([
      userMessage(
        "Taylor texted me this Acme job description. Save it: Lead the engineering organization.",
      ),
    ]).text).toBe("Saved the job description to Acme.");
    expect(model.doStreamCalls).toHaveLength(3);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(gig.id);
    expect(received?.input).toMatchObject({
      links: [{ entityType: "gig", entityId: gig.id }],
      documentType: "job_description",
      sourceDescription: "Shared by Taylor via text message",
    });
  });

  test("reads, resolves, and saves a staged upload without sending content in the user message", async () => {
    const stagedDocuments = new StagedDocumentService();
    const staged = stagedDocuments.stage({
      markdown: "# Example Company\n\nDirector of Engineering source text.",
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
    const gig = {
      id: "gig-example",
      company: "Example Company",
      title: "Director of Engineering",
      stage: "identified",
      outcome: "pending",
    } as const;
    let savedContent: string | undefined;
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({ chunks: [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "read-upload", toolName: "get_document", input: JSON.stringify({ reference: staged.reference }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ] }),
        },
        {
          stream: simulateReadableStream({ chunks: [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "resolve-upload", toolName: "search_gigs_and_people", input: JSON.stringify({ companyNames: ["Example Company"], personNames: [] }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ] }),
        },
        {
          stream: simulateReadableStream({ chunks: [
            { type: "stream-start", warnings: [] },
            { type: "tool-call", toolCallId: "save-upload", toolName: "create_document", input: JSON.stringify({ links: [{ entityType: "gig", entityId: gig.id }], documentType: "job_description", title: "Director of Engineering job description", description: null, sourceKind: "staged_document", content: null, reference: staged.reference, mediaType: "text/markdown", sourceDescription: null }) },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
          ] }),
        },
        {
          stream: simulateReadableStream({ chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text-upload" },
            { type: "text-delta", id: "text-upload", delta: "Saved the uploaded source to Example Company." },
            { type: "text-end", id: "text-upload" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ] }),
        },
      ],
    });
    const tools = createGigFinderTools(
      readerWithGigs([]),
      logger,
      documentMutations((context, input) => {
        savedContent = input.content;
        return {
          document: {
            id: "doc_11111111-1111-4111-8111-111111111111",
            links: input.links,
            documentType: "job_description",
            title: input.title,
            description: input.description ?? null,
            displayName: input.title ?? "Job Description",
            mediaType: input.mediaType,
            sourceDescription: input.sourceDescription,
            filePath: null,
            uploadProvenance: input.uploadProvenance ?? null,
            currentVersion: 1,
            content: input.content,
            contentHash: "content-hash",
            createdAt: "2026-07-29T12:00:00.000Z",
            updatedAt: "2026-07-29T12:00:00.000Z",
          },
          changeId: context.changeId ?? null,
          changed: true,
        };
      }),
      { actor: "Candidate", requestId: "request-upload" },
      {
        stagedDocuments,
        contextSearch: {
          search: () => ({
            gigs: [{ ...gig, matchedCompanyNames: ["Example Company"] }],
            people: [],
            truncated: false,
          }),
        },
      },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });
    const message = `Save the source document staged as ${staged.reference}.`;

    expect(message).not.toContain("Director of Engineering source text");
    expect(await agent.respond([userMessage(message)]).text).toBe(
      "Saved the uploaded source to Example Company.",
    );
    expect(savedContent).toBe(staged.markdown);
    expect(model.doStreamCalls).toHaveLength(4);
  });

  test("asks one targeted question instead of creating when gig matches are ambiguous", async () => {
    const gigs = [
      {
        id: "gig-acme-director",
        company: "Acme",
        title: "Director of Engineering",
      },
      {
        id: "gig-acme-vp",
        company: "Acme",
        title: "VP of Engineering",
      },
    ].map((gig) => gigRecord({
      ...gig,
      stage: "identified" as const,
      outcome: "pending" as const,
      statusSummary: "Considering",
      lastActivity: "2026-07-28",
      nextAction: null,
      fit: { rating: "good" as const, summary: null },
      location: "Remote",
      workArrangement: "remote",
      documents: [],
    }));
    let createCalls = 0;
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "find-gigs",
                toolName: "list_gigs",
                input: JSON.stringify({
                  stages: null,
                  outcomes: null,
                  fitRatings: null,
                  overdueOnly: null,
                  query: "Acme",
                  offset: null,
                  limit: null,
                }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: undefined },
                usage,
              },
            ],
          }),
        },
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              {
                type: "text-delta",
                id: "text-1",
                delta: "Should I attach this to the Director or VP role at Acme?",
              },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: undefined },
                usage,
              },
            ],
          }),
        },
      ],
    });
    const tools = createGigFinderTools(
      readerWithGigs(gigs),
      logger,
      documentMutations(() => {
        createCalls += 1;
        throw new Error("create_document must not run for ambiguous context");
      }),
      { actor: "Candidate", requestId: "request-ambiguous" },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });

    expect(await agent.respond([
      userMessage("Save this job description for Acme: Lead engineering."),
    ]).text).toBe(
      "Should I attach this to the Director or VP role at Acme?",
    );
    expect(createCalls).toBe(0);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  test("asks for missing links before calling create_document", async () => {
    let createCalls = 0;
    const model = mockModel(
      "Which gig should I attach this job description to?",
    );
    const tools = createGigFinderTools(
      readerWithGigs([]),
      logger,
      documentMutations(() => {
        createCalls += 1;
        throw new Error("create_document must not run without links");
      }),
      { actor: "Candidate", requestId: "request-missing-owner" },
    );
    const agent = new GigFinderAgent({
      profile: testCandidateProfile,
      model,
      logger,
      tools,
      canUpdateRecords: true,
    });

    expect(await agent.respond([
      userMessage("Save this job description: Lead engineering."),
    ]).text).toBe("Which gig should I attach this job description to?");
    expect(createCalls).toBe(0);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
      "when ownership or intent is ambiguous",
    );
  });

});
