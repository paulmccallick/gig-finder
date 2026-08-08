import { describe, expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import { isStepCount, streamText, tool } from "ai";
import { gigFinderToolSchemas } from "../../src/agent/gig-finder-tools";
import {
  createSmokeProviderState,
  smokeProviderHandler,
} from "./scripted-provider";

const validSchema = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};

describe("deterministic smoke provider", () => {
  test("reproduces strict-object and unsupported-URI provider failures", async () => {
    const handler = smokeProviderHandler(createSmokeProviderState());
    for (const parameters of [
      { type: "object", properties: { value: { type: "string" } } },
      {
        type: "object",
        properties: { value: { type: "string", format: "uri" } },
        required: ["value"],
        additionalProperties: false,
      },
    ]) {
      const response = await handler(new Request("http://smoke/responses", {
        method: "POST",
        body: JSON.stringify({
          tools: Object.keys((await import("../../src/agent/gig-finder-tools")).gigFinderToolSchemas)
            .map((name, index) => ({
              type: "function",
              name,
              strict: true,
              parameters: index === 0 ? parameters : validSchema,
            })),
        }),
      }));
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invalid_function_parameters");
      expect(body.error.message.length).toBeLessThanOrEqual(240);
    }
  });

  test("drives a complete registry tool loop through the real AI SDK provider adapter", async () => {
    const state = createSmokeProviderState();
    const server = Bun.serve({ port: 0, fetch: smokeProviderHandler(state) });
    try {
      const provider = createOpenAI({
        baseURL: `http://127.0.0.1:${server.port}`,
        apiKey: "unused-smoke-key",
      });
      const tools = Object.fromEntries(Object.entries(gigFinderToolSchemas).map(([name, inputSchema]) => [
        name,
        tool<unknown, { status: "ok" }, Record<string, never>>({
          strict: true,
          description: `Synthetic ${name} smoke tool.`,
          inputSchema,
          execute: async () => ({ status: "ok" }),
        }),
      ]));
      const input = Buffer.from(JSON.stringify({
        stages: null, outcomes: null, fitRatings: null, overdueOnly: null,
        query: null, offset: null, limit: null,
      })).toString("base64url");
      const result = streamText({
        model: provider.responses("gpt-5.6-sol"),
        prompt: `SMOKE_TOOL:sdk-list:list_gigs:${input}`,
        tools,
        stopWhen: isStepCount(2),
      });
      expect(await result.text).toBe("SMOKE_TOOL_OK list_gigs");
      expect(state.registryValidations).toBe(2);
      expect([...state.seenTools]).toEqual(["list_gigs"]);
    } finally {
      await server.stop(true);
    }
  });
});
