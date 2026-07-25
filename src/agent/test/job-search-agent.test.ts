import { describe, expect, test } from "bun:test";
import { simulateReadableStream, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { Logger } from "pino";
import type { AgentContextReader } from "../../core/src";
import { JobSearchAgent } from "../job-search-agent";
import { createJobSearchTools } from "../job-search-tools";
import { testJobSearchProfile } from "./fixtures";
import {
  buildJobSearchInstructions,
  genericJobSearchAgentSystemPrompt,
} from "../system-prompt";

const userMessage = (text: string): ModelMessage => ({
  role: "user",
  content: text,
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

describe("JobSearchAgent instructions", () => {
  test("keeps the generic policy independent of a particular search", () => {
    expect(genericJobSearchAgentSystemPrompt).toContain("You are JobSearchAgent");
    expect(genericJobSearchAgentSystemPrompt).not.toContain("Jordan");
    expect(genericJobSearchAgentSystemPrompt).not.toContain("Consumer services");
    expect(genericJobSearchAgentSystemPrompt).not.toContain("Senior Director");
  });

  test("states the configured live-data boundary", () => {
    expect(buildJobSearchInstructions(testJobSearchProfile)).toContain(
      "no access to live pipeline records",
    );
    expect(buildJobSearchInstructions(testJobSearchProfile, {
      liveDashboardRecords: true,
    })).toContain("read-only tools for current jobs, networking contacts, and tasks");
  });

  test("composes the current user's profile separately", () => {
    const instructions = buildJobSearchInstructions(testJobSearchProfile);
    expect(instructions).toContain("You are JobSearchAgent");
    expect(instructions).toContain("Preferred name: Jordan");
    expect(instructions).toContain("Profession: Product and operations leadership");
    expect(instructions).toContain("Experience level: Experienced people leader");
    expect(instructions).toContain("More than ten years");
    expect(instructions).toContain("Consumer services");
    expect(instructions).toContain("Director of Product");
    expect(instructions).toContain("Hybrid");
    expect(instructions).toContain("Individual-contributor roles");
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
    const agent = new JobSearchAgent({ profile: testJobSearchProfile, model, logger });
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
        toolCalls: [],
        toolResults: [],
      },
    });
    const completion = logEntries.find(entry => entry.data.event === "model.interaction.completed");
    expect(completion?.data).toMatchObject({
      event: "model.interaction.completed",
      usage: {
        inputTokens: 10,
        outputTokens: 8,
        totalTokens: 18,
      },
    });
    expect(completion?.data.latencyMs).toBeNumber();
  });

  test("executes a read tool and streams the model's final answer", async () => {
    const usage = {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 8, text: 8, reasoning: undefined },
    };
    const model = new MockLanguageModelV4({
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: "list_tasks",
                input: JSON.stringify({ statuses: ["open"] }),
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
              { type: "text-delta", id: "text-1", delta: "You have one open task." },
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
    const reader = {
      listJobs: () => ({ items: [], page: { offset: 0, limit: 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
      getJob: (id) => ({ status: "not_found", id }),
      listNetworkingContacts: () => ({ items: [], page: { offset: 0, limit: 20, returned: 0, total: 0, hasMore: false, nextOffset: null } }),
      getNetworkingContact: (id) => ({ status: "not_found", id }),
      listTasks: () => ({
        items: [{
          id: "task-1",
          title: "Reply to recruiter",
          type: "application",
          status: "open",
          priority: "high",
          dueDate: "2026-07-24",
          relatedEntity: { type: "job", id: "job-1", label: "Example" },
          createdAt: "2026-07-23",
          updatedAt: "2026-07-23",
          completedAt: null,
        }],
        page: { offset: 0, limit: 20, returned: 1, total: 1, hasMore: false, nextOffset: null },
      }),
      getTask: (id) => ({ status: "not_found", id }),
    } satisfies AgentContextReader;
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    } as unknown as Logger;
    const agent = new JobSearchAgent({
      profile: testJobSearchProfile,
      model,
      logger,
      tools: createJobSearchTools(reader, logger),
    });

    expect(await agent.respond([userMessage("What is open?")]).text).toBe(
      "You have one open task.",
    );
    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[0]?.tools?.map(({ name }) => name)).toContain("list_tasks");
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Reply to recruiter");
  });

});
