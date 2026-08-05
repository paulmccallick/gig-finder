import { describe, expect, test } from "bun:test";
import {
  compactMessageForPersistence,
  ConversationService,
  type Conversation,
  type ConversationAgentRuntime,
  type ConversationMessage,
  type ConversationStreamEvent,
  type ConversationRepository,
} from "../conversation-service";

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
        output: { documentId: id, version },
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

test("document tool output persists only its ID and version", () => {
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
        record: { reference: "doc-1", currentVersion: 3, content: "private content" },
      },
    }],
  };
  expect(compactMessageForPersistence(message).parts[0]).toMatchObject({
    output: { documentId: "doc-1", version: 3 },
  });
  expect(JSON.stringify(compactMessageForPersistence(message))).not.toContain("private content");
});
