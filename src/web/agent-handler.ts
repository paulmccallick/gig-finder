import {
  convertToModelMessages,
  safeValidateUIMessages,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { Logger } from "pino";
import { createCodexLanguageModel } from "../agent/codex-provider";
import { JobSearchAgent } from "../agent/job-search-agent";
import type { JobSearchProfile } from "../agent/types";
import { createJobSearchTools } from "../agent/job-search-tools";
import type { AgentContextReader, EntityUpdater } from "../core/src";
import { logger as defaultLogger } from "../observability/logger";

type ModelFactory = () => Promise<LanguageModel>;

export const agentLimits = {
  maxMessages: 20,
  maxTextCharacters: 8_000,
  maxTotalCharacters: 24_000,
} as const;

export class WebRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function textCharacters(messages: UIMessage[]) {
  return messages.reduce((total, message) => total + message.parts.reduce(
    (messageTotal, part) => messageTotal + (part.type === "text" ? part.text.length : 0),
    0,
  ), 0);
}

export async function validateAgentMessages(value: unknown): Promise<UIMessage[]> {
  if (!Array.isArray(value)) throw new WebRequestError("Messages must be an array.", 400);
  if (value.length === 0) throw new WebRequestError("At least one message is required.", 400);
  if (value.length > agentLimits.maxMessages) {
    throw new WebRequestError(`A conversation is limited to ${agentLimits.maxMessages} messages.`, 400);
  }
  const sanitized = value.map((message) => {
    if (
      typeof message !== "object"
      || message === null
      || !("role" in message)
      || message.role !== "assistant"
      || !("parts" in message)
      || !Array.isArray(message.parts)
    ) return message;
    return {
      ...message,
      parts: message.parts.filter((part: unknown) => {
        if (typeof part !== "object" || part === null || !("type" in part)) return true;
        return typeof part.type !== "string"
          || (!part.type.startsWith("tool-") && part.type !== "dynamic-tool");
      }),
    };
  });
  const validation = await safeValidateUIMessages({ messages: sanitized });
  if (!validation.success) throw new WebRequestError("The conversation contains invalid messages.", 400);
  for (const message of validation.data) {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new WebRequestError("Only user and assistant messages are accepted.", 400);
    }
    if (message.parts.some(part => part.type !== "text" && part.type !== "step-start")) {
      throw new WebRequestError("Only text messages and stream step markers are supported.", 400);
    }
    if (message.parts.some(part => part.type === "text" && part.text.length > agentLimits.maxTextCharacters)) {
      throw new WebRequestError(`A message is limited to ${agentLimits.maxTextCharacters} characters.`, 400);
    }
  }
  if (textCharacters(validation.data) > agentLimits.maxTotalCharacters) {
    throw new WebRequestError("The active conversation is too long. Start a new session.", 400);
  }
  return validation.data;
}

export function safeAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/codex authentication/i.test(message)) return message;
  if (/unsupported codex model/i.test(message)) return message;
  return "The JobSearchAgent could not complete that response. Please try again.";
}

export function createAgentHandler(
  profile: JobSearchProfile,
  modelFactory: ModelFactory = createCodexLanguageModel,
  logger: Logger = defaultLogger,
  contextReader?: AgentContextReader,
  updater?: EntityUpdater,
  actor = "JobSearchAgent",
) {
  return async (request: Request) => {
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const requestStartedAt = performance.now();
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 128_000) throw new WebRequestError("Request body is too large.", 413);

    let body: { messages?: unknown };
    try {
      body = await request.json() as { messages?: unknown };
    } catch (error) {
      throw new WebRequestError("Request body must be valid JSON.", 400, { cause: error });
    }

    const uiMessages = await validateAgentMessages(body.messages);
    const agentLogger = logger.child({ requestId });
    request.signal.addEventListener("abort", () => {
      agentLogger.warn({
        event: "agent.request.aborted",
        latencyMs: Math.round(performance.now() - requestStartedAt),
        err: request.signal.reason,
      }, "Agent request signal aborted");
    }, { once: true });
    const agent = new JobSearchAgent({
      profile,
      model: await modelFactory(),
      logger: agentLogger,
      tools: contextReader
        ? createJobSearchTools(
          contextReader,
          agentLogger,
          updater,
          { actor, requestId },
        )
        : undefined,
      canUpdateDashboardRecords: updater !== undefined,
    });
    const result = agent.respond(await convertToModelMessages(uiMessages), request.signal);
    return result.toUIMessageStreamResponse({
      sendReasoning: false,
      onError: error => safeAgentError(error),
      onEnd: ({ isAborted, finishReason, responseMessage }) => {
        const partTypes = responseMessage.parts.map((part) => part.type);
        const deliveredTextCharacters = responseMessage.parts.reduce(
          (total, part) => total + (part.type === "text" ? part.text.length : 0),
          0,
        );
        agentLogger.info({
          event: "agent.response.stream.finished",
          outcome: isAborted ? "aborted" : "completed",
          finishReason,
          latencyMs: Math.round(performance.now() - requestStartedAt),
          partTypes,
          deliveredTextCharacters,
        }, "Agent response stream finished");
      },
      headers: {
        "Cache-Control": "no-store",
      },
    });
  };
}
