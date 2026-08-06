import {
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { Logger } from "pino";
import {
  ConversationService,
  ConversationValidationError,
  type ConversationMessage,
  type ConversationPart,
  type ConversationStreamEvent,
} from "../core/conversation-service";

function toolName(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") return part.toolName;
  return part.type.startsWith("tool-") ? part.type.slice(5) : null;
}

export function toConversationMessage(message: unknown): ConversationMessage | unknown {
  if (!message || typeof message !== "object" || !("parts" in message)) return message;
  const value = message as UIMessage;
  const parts: ConversationPart[] = [];
  for (const part of value.parts) {
    if (part.type === "text" || part.type === "reasoning") {
      parts.push({ type: part.type, text: part.text });
      continue;
    }
    if (part.type === "step-start") {
      parts.push({ type: "step-start" });
      continue;
    }
    const name = toolName(part);
    if (!name || !("toolCallId" in part) || !("state" in part)) continue;
    if (part.state === "output-available") parts.push({
      type: "tool", toolName: name, toolCallId: part.toolCallId,
      state: part.state, input: part.input, output: part.output,
      providerExecuted: part.providerExecuted,
    });
    else if (part.state === "output-error") parts.push({
      type: "tool", toolName: name, toolCallId: part.toolCallId,
      state: part.state, input: part.input, errorText: part.errorText,
      providerExecuted: part.providerExecuted,
    });
    else if (part.state === "input-available") parts.push({
      type: "tool", toolName: name, toolCallId: part.toolCallId,
      state: part.state, input: part.input, providerExecuted: part.providerExecuted,
    });
  }
  return {
    id: value.id,
    role: value.role,
    parts,
  };
}

export function toUIMessage(message: ConversationMessage): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.flatMap(part => {
      if (part.type === "attachment") return [];
      if (part.type !== "tool") return part;
      return {
        type: `tool-${part.toolName}`,
        toolCallId: part.toolCallId,
        state: part.state,
        input: part.input,
        ...(part.state === "output-available" ? { output: part.output } : {}),
        ...(part.state === "output-error" ? { errorText: part.errorText ?? "Tool failed." } : {}),
        providerExecuted: part.providerExecuted,
      };
    }) as UIMessage["parts"],
  };
}

function toUIStream(stream: ReadableStream<ConversationStreamEvent>) {
  return stream.pipeThrough(new TransformStream<ConversationStreamEvent, UIMessageChunk>({
    transform(event, controller) {
      if (event.type === "start") {
        controller.enqueue({ type: "start", messageId: event.messageId });
      } else {
        controller.enqueue(event as UIMessageChunk);
      }
    },
  }));
}

export class WebRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AgentApi {
  messages(request: Request): Promise<Response>;
  list(): Response;
  load(id: string): Response;
}

export function createAgentApi(
  conversations: ConversationService,
  logger: Logger,
): AgentApi {
  return {
    async messages(request) {
      const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
      const startedAt = performance.now();
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > 32_000) throw new WebRequestError("Request body is too large.", 413);
      let body: { id?: unknown; message?: unknown };
      try {
        body = await request.json() as typeof body;
      } catch (error) {
        throw new WebRequestError("Request body must be valid JSON.", 400, { cause: error });
      }
      if (typeof body.id !== "string") {
        throw new WebRequestError("A conversation ID is required.", 400);
      }
      try {
        const stream = await conversations.respond({
          conversationId: body.id,
          message: toConversationMessage(body.message),
          requestId,
          signal: request.signal,
        });
        return createUIMessageStreamResponse({
          stream: toUIStream(stream),
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (error instanceof ConversationValidationError) {
          throw new WebRequestError(error.message, 400, { cause: error });
        }
        throw error;
      } finally {
        logger.debug({
          event: "agent.request.delegated",
          requestId,
          latencyMs: Math.round(performance.now() - startedAt),
        }, "Delegated agent request to conversation service");
      }
    },
    list() {
      return Response.json({ conversations: conversations.list() }, {
        headers: { "Cache-Control": "no-store" },
      });
    },
    load(id) {
      const result = conversations.load(id);
      return result
        ? Response.json({
            conversation: result.conversation,
            messages: result.messages.map(toUIMessage),
          }, { headers: { "Cache-Control": "no-store" } })
        : Response.json({ error: "Conversation not found" }, { status: 404 });
    },
  };
}
