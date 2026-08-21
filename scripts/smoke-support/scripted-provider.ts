import { gigFinderToolSchemas } from "../../src/agent/gig-finder-tools";
import {
  ProviderToolSchemaError,
  validateProviderToolJsonSchema,
} from "./tool-schema-validation";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bounded = (value: string) => value.replace(/\s+/g, " ").slice(0, 240);

export interface SmokeProviderState {
  requests: number;
  registryValidations: number;
  hydrationValidations: number;
  seenTools: Set<string>;
  requestBodies: JsonRecord[];
}

export const createSmokeProviderState = (): SmokeProviderState => ({
  requests: 0,
  registryValidations: 0,
  hydrationValidations: 0,
  seenTools: new Set(),
  requestBodies: [],
});

class RegistryValidationError extends Error {
  constructor(
    readonly schemaError: ProviderToolSchemaError,
    readonly toolIndex: number,
  ) {
    super(schemaError.message);
  }
}

function invalidSchemaResponse(error: ProviderToolSchemaError, index: number) {
  return Response.json({
    error: {
      message: bounded(error.message),
      type: "invalid_request_error",
      param: `tools[${index}].parameters`,
      code: "invalid_function_parameters",
    },
  }, { status: 400 });
}

function validateRegistry(body: JsonRecord) {
  if (!Array.isArray(body.tools)) throw new Error("Complete tool registry is required.");
  const expected = Object.keys(gigFinderToolSchemas).sort();
  const names = body.tools.flatMap(tool => record(tool) && typeof tool.name === "string"
    ? [tool.name]
    : []).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error("Tool registry does not match the GigFinder runtime registry.");
  }
  body.tools.forEach((unknownTool, index) => {
    if (!record(unknownTool) || unknownTool.type !== "function"
      || typeof unknownTool.name !== "string" || unknownTool.strict !== true) {
      throw new Error(`Tool registry entry ${index} is not a strict function tool.`);
    }
    try {
      validateProviderToolJsonSchema(unknownTool.name, unknownTool.parameters);
    } catch (error) {
      if (error instanceof ProviderToolSchemaError) {
        throw new RegistryValidationError(error, index);
      }
      throw error;
    }
  });
}

const values = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(values);
  if (record(value)) return Object.values(value).flatMap(values);
  return [];
};

type Scenario =
  | { kind: "tool"; id: string; toolName: string; input: unknown }
  | { kind: "hydration"; id: string; expectedText: string };

function scenario(body: JsonRecord): Scenario | null {
  const strings = values(body.input);
  for (let index = strings.length - 1; index >= 0; index -= 1) {
    const value = strings[index]!;
    const tool = value.match(/SMOKE_TOOL:([a-z0-9-]+):([a-z0-9_]+):([A-Za-z0-9_-]+)/);
    if (tool) {
      return {
        kind: "tool",
        id: tool[1]!,
        toolName: tool[2]!,
        input: JSON.parse(Buffer.from(tool[3]!, "base64url").toString("utf8")),
      };
    }
    const hydration = value.match(/SMOKE_HYDRATION:([a-z0-9-]+):([A-Za-z0-9_-]+)/);
    if (hydration) {
      return {
        kind: "hydration",
        id: hydration[1]!,
        expectedText: Buffer.from(hydration[2]!, "base64url").toString("utf8"),
      };
    }
  }
  return null;
}

function hasToolOutput(body: JsonRecord, callId: string) {
  return Array.isArray(body.input) && body.input.some(item =>
    record(item) && item.type === "function_call_output" && item.call_id === callId);
}

const usage = {
  input_tokens: 20,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 8,
  output_tokens_details: { reasoning_tokens: 0 },
};

function sse(events: unknown[]) {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
}

function completed() {
  return {
    type: "response.completed",
    response: { usage, incomplete_details: null },
  };
}

function textResponse(id: string, text: string) {
  const itemId = `msg_${id}`;
  return sse([
    { type: "response.created", response: { id: `resp_${id}`, created_at: 1, model: "smoke-codex" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id: itemId, phase: "final_answer" } },
    { type: "response.output_text.delta", item_id: itemId, delta: text },
    { type: "response.output_item.done", output_index: 0, item: { type: "message", id: itemId, phase: "final_answer" } },
    completed(),
  ]);
}

function toolResponse(id: string, toolName: string, input: unknown) {
  const callId = `call_${id}`;
  const itemId = `fc_${id}`;
  const argumentsText = JSON.stringify(input);
  return sse([
    { type: "response.created", response: { id: `resp_${id}`, created_at: 1, model: "smoke-codex" } },
    { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name: toolName, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: itemId, output_index: 0, delta: argumentsText },
    { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: itemId, call_id: callId, name: toolName, arguments: argumentsText, status: "completed" } },
    completed(),
  ]);
}

function providerFailure(message: string) {
  return Response.json({
    error: {
      message: bounded(message),
      type: "invalid_request_error",
      code: "invalid_function_parameters",
    },
  }, { status: 400 });
}

export function smokeProviderHandler(state: SmokeProviderState) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok", knownProviderRules: ["strict_objects", "unsupported_uri"] });
    }
    if (url.pathname === "/status") {
      return Response.json({
        requests: state.requests,
        registryValidations: state.registryValidations,
        hydrationValidations: state.hydrationValidations,
        seenTools: [...state.seenTools].sort(),
      });
    }
    if (url.pathname !== "/responses" || request.method !== "POST") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    state.requests += 1;
    let body: JsonRecord;
    try {
      const parsed: unknown = await request.json();
      if (!record(parsed)) throw new Error("Request body must be an object.");
      body = parsed;
      state.requestBodies.push(body);
    } catch {
      return providerFailure("Request body must be valid JSON.");
    }
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      try {
        validateRegistry(body);
        state.registryValidations += 1;
      } catch (caught) {
        if (caught instanceof RegistryValidationError) {
          return invalidSchemaResponse(caught.schemaError, caught.toolIndex);
        }
        return providerFailure(caught instanceof Error ? caught.message : "Tool registry validation failed.");
      }
    } else {
      const serialized = JSON.stringify(body);
      if (serialized.includes("GigFinder Scout's narrow relevance screener")) {
        return textResponse(`scout_relevance_${state.requests}`, JSON.stringify({
          decision: "passes_relevance",
          reason: "The description explicitly describes technology leadership.",
          confidence: 0.97,
          evidence: ["The description explicitly leads a technology team."],
          ambiguities: [],
        }));
      }
      if (serialized.includes("GigFinder Scout's candidate-match scorer")) {
        return textResponse(`scout_match_${state.requests}`, JSON.stringify({
          score: 8,
          scoreExplanation: "The synthetic profile aligns with the leadership scope.",
        }));
      }
      return textResponse(`title_${state.requests}`, "Synthetic smoke conversation");
    }
    let scripted: Scenario | null;
    try {
      scripted = scenario(body);
    } catch {
      return providerFailure("Smoke scenario input is invalid.");
    }
    if (!scripted) return providerFailure("Smoke scenario marker is required.");
    if (scripted.kind === "hydration") {
      const serialized = JSON.stringify(body.input);
      if (!serialized.includes(scripted.expectedText)) {
        return providerFailure("Persisted document context was not hydrated.");
      }
      state.hydrationValidations += 1;
      return textResponse(scripted.id, "SMOKE_HYDRATION_OK");
    }
    if (!Object.hasOwn(gigFinderToolSchemas, scripted.toolName)) {
      return providerFailure(`Unknown scripted tool: ${scripted.toolName}`);
    }
    state.seenTools.add(scripted.toolName);
    const callId = `call_${scripted.id}`;
    return hasToolOutput(body, callId)
      ? textResponse(scripted.id, `SMOKE_TOOL_OK ${scripted.toolName}`)
      : toolResponse(scripted.id, scripted.toolName, scripted.input);
  };
}
