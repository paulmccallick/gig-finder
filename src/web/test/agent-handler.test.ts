import { describe, expect, test } from "bun:test";
import pino from "pino";
import type { ConversationService } from "../../core/conversation-service";
import {
  createAgentApi,
  toConversationMessage,
  toUIMessage,
  WebRequestError,
} from "../agent-handler";

const logger = pino({ enabled: false });

describe("agent HTTP adapter", () => {
  test("delegates the latest message and conversation ID to core", async () => {
    const calls: unknown[] = [];
    const service = {
      respond: async (input: unknown) => {
        calls.push(input);
        return new ReadableStream({ start(controller) { controller.close(); } });
      },
      list: () => [],
      load: () => null,
    } as unknown as ConversationService;
    const api = createAgentApi(service, logger);
    const message = { id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] };
    const response = await api.messages(new Request("http://localhost/api/agent/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "request-1" },
      body: JSON.stringify({ id: "conversation-1", message }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      conversationId: "conversation-1",
      message,
      requestId: "request-1",
    });
  });

  test("rejects malformed requests before calling core", async () => {
    const service = { list: () => [], load: () => null } as unknown as ConversationService;
    const api = createAgentApi(service, logger);
    await expect(api.messages(new Request("http://localhost/api/agent/messages", {
      method: "POST",
      body: JSON.stringify({ message: null }),
    }))).rejects.toBeInstanceOf(WebRequestError);
  });
});

test("web owns the mapping between AI SDK UI and conversation tool parts", () => {
  const uiMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [{
      type: "tool-get_document" as const,
      toolCallId: "call-1",
      state: "output-available" as const,
      input: { reference: "doc-1" },
      output: { documentId: "doc-1", version: 2 },
    }],
  };
  const conversationMessage = toConversationMessage(uiMessage);
  expect(conversationMessage).toMatchObject({
    parts: [{ type: "tool", toolName: "get_document" }],
  });
  expect(toUIMessage(conversationMessage as Parameters<typeof toUIMessage>[0]))
    .toEqual(uiMessage);
});

test("web omits structured staged attachment capabilities from restored messages", () => {
  expect(toUIMessage({
    id: "user-attachment",
    role: "user",
    parts: [
      { type: "text", text: "Attached staged document: [attached document]" },
      {
        type: "attachment",
        reference: "staged-document:11111111-1111-4111-8111-111111111111",
      },
    ],
  })).toEqual({
    id: "user-attachment",
    role: "user",
    parts: [{ type: "text", text: "Attached staged document: [attached document]" }],
  });
});
