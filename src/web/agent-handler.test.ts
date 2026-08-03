import { describe, expect, test } from "bun:test";
import { simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  agentLimits,
  createAgentHandler,
  validateAgentMessages,
  WebRequestError,
} from "./agent-handler";
import { testCandidateProfile } from "../agent/test/fixtures";
import { DomainValidationError } from "../core/src";
import { toWebError } from "./error-response";

const userMessage = (text: string): UIMessage => ({
  id: "message-1",
  role: "user",
  parts: [{ type: "text", text }],
});

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

describe("agent web adapter", () => {
  test("maps domain validation failures to an actionable 422 response", () => {
    expect(toWebError(new DomainValidationError(
      "Gig role-1 cannot be closed while its outcome is pending.",
    ))).toEqual({
      status: 422,
      body: {
        error: "Gig role-1 cannot be closed while its outcome is pending.",
        code: "domain_validation_failed",
      },
    });
  });
  test("accepts bounded text-only UI messages", async () => {
    await expect(validateAgentMessages([userMessage("Help me assess a role.")])).resolves.toHaveLength(1);
  });

  test("accepts the step marker Vercel AI SDK includes in assistant history", async () => {
    const conversation: UIMessage[] = [
      userMessage("Hello"),
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "text", text: "How can I help?" },
        ],
      },
      {
        id: "message-2",
        role: "user",
        parts: [{ type: "text", text: "Tell me more." }],
      },
    ];

    await expect(validateAgentMessages(conversation)).resolves.toEqual(conversation);
  });

  test("removes server tool parts before reusing assistant history", async () => {
    const messages = await validateAgentMessages([
      userMessage("What is open?"),
      {
        id: "assistant-tool-message",
        role: "assistant",
        parts: [
          { type: "step-start" },
          {
            type: "tool-list_tasks",
            toolCallId: "tool-call-1",
            state: "output-available",
            input: { statuses: ["open"] },
            output: { items: [] },
          },
          { type: "text", text: "No open tasks." },
        ],
      },
    ]);
    expect(messages[1]?.parts).toEqual([
      { type: "step-start" },
      { type: "text", text: "No open tasks." },
    ]);
  });

  test("rejects invalid UI conversations with web request errors", async () => {
    await expect(validateAgentMessages([])).rejects.toMatchObject({
      message: "At least one message is required.",
      status: 400,
    });
    await expect(validateAgentMessages([userMessage("x".repeat(agentLimits.maxTextCharacters + 1))]))
      .rejects.toThrow("A message is limited");
    await expect(validateAgentMessages([{
      id: "file-message",
      role: "user",
      parts: [{ type: "file", mediaType: "text/plain", filename: "private.txt", url: "data:text/plain,test" }],
    }])).rejects.toBeInstanceOf(WebRequestError);
  });

  test("serves the POST contract through an injected model", async () => {
    const handler = createAgentHandler({
      profile: testCandidateProfile,
      modelFactory: async () => mockModel("This is a deterministic response."),
    });
    const response = await handler(new Request("http://localhost/api/agent/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [userMessage("Hello")] }),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(await response.text()).toContain("This is a deterministic response.");
  });

  test("resolves the selected model for each new request", async () => {
    const selectedModels: string[] = [];
    const handler = createAgentHandler({
      profile: testCandidateProfile,
      modelFactory: async modelId => {
        selectedModels.push(modelId);
        return mockModel();
      },
      selectModel: () => "gpt-5.6-terra",
    });
    const response = await handler(new Request("http://localhost/api/agent/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [userMessage("Hello")] }),
    }));
    await response.text();
    expect(selectedModels).toEqual(["gpt-5.6-terra"]);
  });

  test("throws validation errors for the server boundary to log and map", async () => {
    let modelCreated = false;
    const handler = createAgentHandler({
      profile: testCandidateProfile,
      modelFactory: async () => {
        modelCreated = true;
        return mockModel();
      },
    });
    const request = new Request("http://localhost/api/agent/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    await expect(handler(request)).rejects.toMatchObject({
      message: "At least one message is required.",
      status: 400,
    });
    expect(modelCreated).toBe(false);
  });
});
