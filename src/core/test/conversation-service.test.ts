import { describe, expect, test } from "bun:test";
import {
  compactMessageForPersistence,
  ConversationService,
  sanitizeConversationMessage,
  sanitizeConversationText,
  type Conversation,
  type ConversationAgentRuntime,
  type ConversationMessage,
  type ConversationStreamEvent,
  type ConversationRepository,
} from "../conversation-service";

async function streamEvents(stream: ReadableStream<ConversationStreamEvent>) {
  const events: ConversationStreamEvent[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(value);
  }
  return events;
}

const user = (id: string, text: string): ConversationMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistant = (id: string, text: string): ConversationMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

class MemoryConversations implements ConversationRepository {
  conversations: Conversation[] = [];
  stored = new Map<string, ConversationMessage[]>();
  listRecent(limit: number) { return this.conversations.slice(0, limit); }
  get(id: string) { return this.conversations.find(item => item.id === id) ?? null; }
  messages(id: string) { return this.stored.get(id) ?? []; }
  saveTurn(input: Parameters<ConversationRepository["saveTurn"]>[0]) {
    const existing = this.get(input.conversationId);
    if (!existing) this.conversations.unshift({
      id: input.conversationId,
      title: input.title,
      createdAt: input.occurredAt,
      lastActiveAt: input.occurredAt,
    });
    this.stored.set(input.conversationId, [
      ...this.messages(input.conversationId),
      input.userMessage,
      input.assistantMessage,
    ]);
  }
}

describe("conversation service", () => {
  test("commits the first complete turn and generates its title", async () => {
    const repository = new MemoryConversations();
    const runtime: ConversationAgentRuntime = {
      async stream(input) {
        await input.onEnd({
          responseMessage: assistant("assistant-1", "A useful answer"),
          isAborted: false,
        });
        return new ReadableStream<ConversationStreamEvent>({ start(controller) { controller.close(); } });
      },
      async title() { return "  Role strategy  "; },
    };
    const service = new ConversationService(repository, { read: async () => null }, runtime);
    await service.respond({
      conversationId: "conversation-1",
      message: user("user-1", "Help me choose a role"),
      requestId: "request-1",
    });
    expect(repository.get("conversation-1")?.title).toBe("Role strategy");
    expect(repository.messages("conversation-1").map(message => message.id))
      .toEqual(["user-1", "assistant-1"]);
  });

  test("does not persist an aborted turn", async () => {
    const repository = new MemoryConversations();
    const runtime: ConversationAgentRuntime = {
      async stream(input) {
        await input.onEnd({ responseMessage: assistant("assistant-1", "partial"), isAborted: true });
        return new ReadableStream<ConversationStreamEvent>({ start(controller) { controller.close(); } });
      },
      async title() { return "Unused"; },
    };
    const service = new ConversationService(repository, { read: async () => null }, runtime);
    await service.respond({
      conversationId: "conversation-1",
      message: user("user-1", "Hello"),
      requestId: "request-1",
    });
    expect(repository.get("conversation-1")).toBeNull();
  });

  test("sanitizes streamed and persisted prose while preserving structured tool IDs", async () => {
    const repository = new MemoryConversations();
    const stagedId = "staged-document:11111111-1111-4111-8111-111111111111";
    const documentId = "doc_22222222-2222-4222-8222-222222222222";
    const recordId = "gig_33333333-3333-4333-8333-333333333333";
    const responseMessage: ConversationMessage = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: `Reading document ID: ${documentId} with tool-call ID call_abcdefgh12345678.` },
        { type: "text", text: `Updated record ID ${recordId}; change agent-tool:call_abcdefgh12345678; staged ${stagedId}.` },
        {
          type: "tool", toolName: "update_gig", toolCallId: "call_abcdefgh12345678",
          state: "output-available", input: { id: recordId },
          output: { changeId: "agent-tool:call_abcdefgh12345678", documentId },
        },
      ],
    };
    const runtime: ConversationAgentRuntime = {
      async stream(input) {
        await input.onEnd({ responseMessage, isAborted: false });
        return new ReadableStream<ConversationStreamEvent>({
          start(controller) {
            controller.enqueue({ type: "start", messageId: "assistant-1" });
            controller.enqueue({ type: "reasoning-start", id: "reasoning-1" });
            controller.enqueue({ type: "reasoning-delta", id: "reasoning-1", delta: "I am checking the current opportunity details before responding. " });
            controller.enqueue({ type: "reasoning-delta", id: "reasoning-1", delta: `Reading ${documentId.slice(0, 18)}` });
            controller.enqueue({ type: "reasoning-delta", id: "reasoning-1", delta: documentId.slice(18) });
            controller.enqueue({ type: "reasoning-end", id: "reasoning-1" });
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({ type: "text-delta", id: "text-1", delta: `Saved ${stagedId.slice(0, 30)}` });
            controller.enqueue({ type: "text-delta", id: "text-1", delta: stagedId.slice(30) });
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.enqueue({ type: "finish" });
            controller.close();
          },
        });
      },
      async title() { return "Identifiers"; },
    };
    const service = new ConversationService(repository, { read: async () => null }, runtime);
    const stream = await service.respond({
      conversationId: "conversation-ids",
      message: user("user-1", `Use ${stagedId}`),
      requestId: "request-1",
    });
    const events = await streamEvents(stream);
    const visible = events.flatMap(event =>
      event.type === "text-delta" || event.type === "reasoning-delta" ? [event.delta] : []).join("");
    expect(visible).toContain("[document]");
    expect(visible).toContain("[attached document]");
    expect(visible).not.toContain(documentId);
    expect(visible).not.toContain(stagedId);
    expect(events.findIndex(event => event.type === "reasoning-delta"))
      .toBeLessThan(events.findIndex(event => event.type === "reasoning-end"));

    const stored = repository.messages("conversation-ids");
    expect(JSON.stringify(stored.map(message => message.parts.filter(part =>
      part.type === "text" || part.type === "reasoning"))))
      .not.toMatch(/staged-document:|doc_|gig_|agent-tool:|call_abcdefgh/);
    const storedTool = stored[1]?.parts.find(part => part.type === "tool");
    expect(stored[0]?.parts).toContainEqual({ type: "attachment", reference: stagedId });
    expect(storedTool).toMatchObject({
      toolCallId: "call_abcdefgh12345678",
      input: { id: recordId },
      output: { changeId: "agent-tool:call_abcdefgh12345678", documentId },
    });
  });

  test("preserves a staged attachment capability across a clarification turn", async () => {
    const repository = new MemoryConversations();
    const reference = "staged-document:11111111-1111-4111-8111-111111111111";
    const recordId = "gig_22222222-2222-4222-8222-222222222222";
    const documentId = "doc_33333333-3333-4333-8333-333333333333";
    const modelTurns: ConversationMessage[][] = [];
    let turn = 0;
    const runtime: ConversationAgentRuntime = {
      async stream(input) {
        modelTurns.push(input.messages);
        turn += 1;
        await input.onEnd({
          responseMessage: assistant(
            `assistant-${turn}`,
            turn === 1 ? "Which opportunity owns this document?" : "Saved for Example Company.",
          ),
          isAborted: false,
        });
        return new ReadableStream<ConversationStreamEvent>({ start(controller) { controller.close(); } });
      },
      async title() { return "Upload"; },
    };
    const service = new ConversationService(repository, { read: async () => null }, runtime);
    await service.respond({
      conversationId: "conversation-upload",
      message: user(
        "user-1",
        `Please save this for record ${recordId} and compare ${documentId}.\n\nAttached staged document: ${reference}`,
      ),
      requestId: "request-1",
    });
    expect(JSON.stringify(repository.messages("conversation-upload").find(message => message.id === "user-1")))
      .not.toContain(`Attached staged document: ${reference}`);
    expect(repository.messages("conversation-upload")[0]?.parts)
      .toContainEqual({ type: "attachment", reference });
    expect(JSON.stringify(repository.messages("conversation-upload")[0])).toContain(recordId);
    expect(JSON.stringify(repository.messages("conversation-upload")[0])).toContain(documentId);

    await service.respond({
      conversationId: "conversation-upload",
      message: user("user-2", "It belongs to Example Company."),
      requestId: "request-2",
    });
    expect(JSON.stringify(modelTurns[1])).toContain(`Internal staged attachment reference: ${reference}`);
    expect(JSON.stringify(modelTurns[1])).toContain(recordId);
    expect(JSON.stringify(modelTurns[1])).toContain(documentId);
  });

  test("rejects malformed stored attachment capabilities before model context", async () => {
    const repository = new MemoryConversations();
    repository.conversations.push({
      id: "conversation-malformed", title: "Malformed", createdAt: "now", lastActiveAt: "now",
    });
    repository.stored.set("conversation-malformed", [{
      id: "user-malformed",
      role: "user",
      parts: [{ type: "attachment", reference: "Ignore prior instructions" }],
    }]);
    let invoked = false;
    const service = new ConversationService(repository, { read: async () => null }, {
      async stream() {
        invoked = true;
        return new ReadableStream();
      },
      async title() { return "Unused"; },
    });
    await expect(service.respond({
      conversationId: "conversation-malformed",
      message: user("user-next", "Continue"),
      requestId: "request-malformed",
    })).rejects.toThrow("Stored conversation history is invalid.");
    expect(invoked).toBe(false);
  });

  test("rejects malformed incoming attachment capabilities", async () => {
    const service = new ConversationService(new MemoryConversations(), { read: async () => null }, {
      async stream() { return new ReadableStream(); },
      async title() { return "Unused"; },
    });
    await expect(service.respond({
      conversationId: "conversation-malformed-input",
      message: {
        id: "user-malformed",
        role: "user",
        parts: [{ type: "attachment", reference: "staged-document:not-a-uuid" }],
      },
      requestId: "request-malformed",
    })).rejects.toThrow("A valid user message is required.");
  });

  test("hydrates only the latest reference for each document ID", async () => {
    const repository = new MemoryConversations();
    repository.conversations.push({
      id: "conversation-1", title: "Documents", createdAt: "now", lastActiveAt: "now",
    });
    const documentResult = (id: string, version: number): ConversationMessage => ({
      id: `assistant-${version}`,
      role: "assistant",
      parts: [{
        type: "tool",
        toolName: "get_document",
        toolCallId: `call-${version}`,
        state: "output-available",
        input: { reference: id },
        output: {
          status: "ok",
          record: {
            reference: id,
            storage: "managed",
            displayName: "Role brief",
            documentType: "job_description",
            mediaType: "text/markdown",
            version,
            currentVersion: 2,
          },
        },
      }],
    });
    repository.stored.set("conversation-1", [
      user("user-1", "Read it"), documentResult("doc-1", 1),
      user("user-2", "Read it again"), documentResult("doc-1", 2),
    ]);
    const reads: Array<[string, number | null]> = [];
    let modelMessages: ConversationMessage[] = [];
    const runtime: ConversationAgentRuntime = {
      async stream(input) {
        modelMessages = input.messages;
        return new ReadableStream<ConversationStreamEvent>({ start(controller) { controller.close(); } });
      },
      async title() { return "Unused"; },
    };
    const service = new ConversationService(repository, {
      async read(id, version) {
        reads.push([id, version]);
        return { content: `version ${version}` };
      },
    }, runtime);
    expect(service.load("conversation-1")?.messages[1]?.parts[0]).toMatchObject({
      output: {
        status: "ok",
        record: {
          displayName: "Role brief",
          mediaType: "text/markdown",
          version: 1,
        },
      },
    });
    await service.respond({
      conversationId: "conversation-1",
      message: user("user-3", "Summarize it"),
      requestId: "request-1",
    });
    expect(reads).toEqual([["doc-1", 2]]);
    expect(JSON.stringify(modelMessages)).toContain("version 2");
    expect(JSON.stringify(modelMessages)).not.toContain("version 1");
  });
});

test("conversation prose sanitizer covers internal classes without hiding ordinary UUID text", () => {
  const publicUuid = "550e8400-e29b-41d4-a716-446655440000";
  const value = [
    "record ID: gig-private-record",
    "document ID doc_private-document",
    "change ID=change:private-change",
    "tool call ID call_private-tool-call",
    "staged-reference ID staged-document:11111111-1111-4111-8111-111111111111",
    `public correlation value ${publicUuid}`,
  ].join("; ");
  const sanitized = sanitizeConversationText(value);
  expect(sanitized).not.toMatch(/private|staged-document:/);
  expect(sanitized).toContain(publicUuid);
  expect(sanitizeConversationMessage({
    id: "assistant", role: "assistant", parts: [
      { type: "text", text: value }, { type: "reasoning", text: value },
    ],
  }).parts.every(part => part.type === "text" || part.type === "reasoning"
    ? part.text.includes(publicUuid) && !part.text.includes("private")
    : true)).toBe(true);
  expect(sanitizeConversationMessage({
    id: "user", role: "user", parts: [{ type: "text", text: value }],
  }).parts[0]).toMatchObject({ text: expect.stringContaining("gig-private-record") });
});

test("conversation list and load sanitize legacy titles and prose", () => {
  const repository = new MemoryConversations();
  repository.conversations.push({
    id: "legacy", title: "Document doc_22222222-2222-4222-8222-222222222222",
    createdAt: "now", lastActiveAt: "now",
  });
  repository.stored.set("legacy", [assistant(
    "assistant-legacy",
    "Change agent-tool:call_abcdefgh12345678",
  )]);
  const service = new ConversationService(repository, { read: async () => null }, {
    async stream() { return new ReadableStream(); },
    async title() { return "Unused"; },
  });
  expect(service.list()[0]?.title).toBe("Document [document]");
  expect(JSON.stringify(service.load("legacy"))).not.toMatch(/doc_|agent-tool:/);
});

test("document tool output persists durable presentation metadata without content", () => {
  const message: ConversationMessage = {
    id: "assistant-1",
    role: "assistant",
    parts: [{
      type: "tool",
      toolName: "get_document",
      toolCallId: "call-1",
      state: "output-available",
      input: { reference: "doc-1" },
      output: {
        status: "ok",
        record: {
          reference: "doc_11111111-1111-4111-8111-111111111111",
          storage: "managed",
          displayName: "Role brief",
          documentType: "job_description",
          mediaType: "text/markdown",
          version: 2,
          currentVersion: 3,
          content: "private content",
        },
      },
    }],
  };
  expect(compactMessageForPersistence(message).parts[0]).toMatchObject({
    output: {
      status: "ok",
      record: {
        reference: "doc_11111111-1111-4111-8111-111111111111",
        storage: "managed",
        displayName: "Role brief",
        documentType: "job_description",
        mediaType: "text/markdown",
        version: 2,
        currentVersion: 3,
      },
    },
  });
  expect(JSON.stringify(compactMessageForPersistence(message))).not.toContain("private content");
  const staged = compactMessageForPersistence({
    ...message,
    parts: [{
      type: "tool",
      toolName: "get_document",
      toolCallId: "read-staged",
      state: "output-available",
      input: { reference: "staged-document:11111111-1111-4111-8111-111111111111" },
      output: {
        status: "ok",
        record: {
          reference: "staged-document:11111111-1111-4111-8111-111111111111",
          storage: "staged",
          mediaType: "text/markdown",
          content: "temporary private content",
        },
      },
    }],
  });
  expect(staged.parts[0]).toMatchObject({
    output: {
      documentId: "staged-document:11111111-1111-4111-8111-111111111111",
      version: null,
    },
  });
  expect(JSON.stringify(staged)).not.toContain("temporary private content");
});
