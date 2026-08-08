import { describe, expect, test } from "bun:test";
import type { ConversationMessage } from "../../core/conversation-service";
import {
  conversationStream,
  safeAgentError,
  toModelMessages,
} from "../ai-sdk-conversation-runtime";

describe("AI SDK conversation adapter", () => {
  test("surfaces only explicitly bounded live-smoke provider errors", () => {
    expect(safeAgentError(new Error("Codex provider rejected live smoke request (400): invalid tool registry")))
      .toBe("Codex provider rejected live smoke request (400): invalid tool registry");
    expect(safeAgentError(new Error("private provider failure")))
      .toBe("The GigFinderAgent could not complete that response. Please try again.");
  });

  test("maps application messages and completed tools to model messages", () => {
    const messages: ConversationMessage[] = [{
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Tell me about the role" }],
    }, {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool",
          toolName: "get_document",
          toolCallId: "call-1",
          state: "output-available",
          input: { reference: "doc-1" },
          output: { record: { reference: "doc-1", content: "description" } },
        },
        { type: "step-start" },
        { type: "text", text: "Here is the summary." },
      ],
    }];

    expect(toModelMessages(messages)).toEqual([
      { role: "user", content: "Tell me about the role" },
      { role: "assistant", content: [{
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "get_document",
        input: { reference: "doc-1" },
        providerExecuted: undefined,
      }] },
      { role: "tool", content: [{
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "get_document",
        output: {
          type: "json",
          value: { record: { reference: "doc-1", content: "description" } },
        },
      }] },
      { role: "assistant", content: [{ type: "text", text: "Here is the summary." }] },
    ]);
  });

  test("reports a streamed error as a failed completion", async () => {
    async function* events() {
      yield { type: "text-start", id: "text-1" };
      yield { type: "text-delta", id: "text-1", text: "partial" };
      yield { type: "error", error: new Error("provider failed") };
    }
    let completion: Parameters<Parameters<typeof conversationStream>[1]>[0] | undefined;
    const stream = conversationStream(events(), event => {
      completion = event;
    });

    const streamed = [];
    const reader = stream.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      streamed.push(result.value);
    }

    expect(streamed.at(-1)).toEqual({
      type: "error",
      errorText: "The GigFinderAgent could not complete that response. Please try again.",
    });
    expect(completion).toMatchObject({
      isAborted: false,
      finishReason: "error",
      responseMessage: {
        role: "assistant",
        parts: [{ type: "text", text: "partial" }],
      },
    });
  });
});
