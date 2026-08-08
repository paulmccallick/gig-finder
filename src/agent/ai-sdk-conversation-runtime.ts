import {
  generateText,
  type AssistantContent,
  type LanguageModel,
  type ModelMessage,
  type ToolContent,
} from "ai";
import type { Logger } from "pino";
import type {
  ConversationAgentRuntime,
  ConversationMessage,
  ConversationPart,
  ConversationStreamEvent,
} from "../core/conversation-service";
import {
  defaultAgentModelId,
  type AgentModelId,
} from "../core/application-settings";
import type { ProfileDocumentContext } from "../core/documents";
import { createCodexLanguageModel } from "./codex-provider";
import { GigFinderAgent } from "./gig-finder-agent";
import {
  createGigFinderTools,
  type GigFinderMutationCapabilities,
  type GigFinderReadCapabilities,
  type GigFinderToolExtensions,
} from "./gig-finder-tools";
import type { CandidateProfile } from "./types";

type ModelFactory = (modelId: AgentModelId) => Promise<LanguageModel>;

interface GigFinderConversationRuntimeBaseOptions {
  profile: CandidateProfile;
  profileDocuments?: () => ProfileDocumentContext[];
  modelFactory?: ModelFactory;
  selectModel?: () => AgentModelId;
  logger: Logger;
  maxSteps?: number;
  maxOutputTokens?: number;
}

export type GigFinderConversationRuntimeOptions = GigFinderConversationRuntimeBaseOptions & (
  | {
      reads: GigFinderReadCapabilities;
      mutations: GigFinderMutationCapabilities;
      actor?: string;
      toolExtensions: GigFinderToolExtensions;
    }
  | {
      reads?: undefined;
      mutations?: undefined;
      actor?: undefined;
      toolExtensions?: undefined;
    }
);

export function safeAgentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/codex authentication/i.test(message)) return message;
  if (/unsupported codex model/i.test(message)) return message;
  if (/codex provider rejected live smoke request/i.test(message)) return message;
  return "The GigFinderAgent could not complete that response. Please try again.";
}

function text(message: ConversationMessage) {
  return message.parts
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("");
}

function toolOutput(output: unknown, error = false) {
  if (error) return { type: "error-text" as const, value: String(output) };
  return { type: "json" as const, value: output as never };
}

function streamText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function toModelMessages(messages: ConversationMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      result.push({ role: "user", content: text(message) });
      continue;
    }
    let block: ConversationPart[] = [];
    const flush = () => {
      if (block.length === 0) return;
      const toolParts = block.filter(part => part.type === "tool");
      const assistantContent: AssistantContent = [];
      for (const part of block) {
        if (part.type === "text") assistantContent.push({ type: "text", text: part.text });
        else if (part.type === "reasoning") assistantContent.push({ type: "reasoning", text: part.text });
        else if (part.type === "tool") assistantContent.push({
          type: "tool-call" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          providerExecuted: part.providerExecuted,
        });
      }
      if (assistantContent.length > 0) result.push({ role: "assistant", content: assistantContent });
      const completed = toolParts.filter(part => part.state !== "input-available");
      if (completed.length > 0) result.push({
        role: "tool",
        content: completed.map(part => ({
          type: "tool-result" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: toolOutput(
            part.state === "output-error" ? part.errorText : part.output,
            part.state === "output-error",
          ),
        })) as ToolContent,
      });
      block = [];
    };
    for (const part of message.parts) {
      if (part.type === "step-start") flush();
      else block.push(part);
    }
    flush();
  }
  return result;
}

function updatePart(
  parts: ConversationPart[],
  predicate: (part: ConversationPart) => boolean,
  update: (part: ConversationPart) => ConversationPart,
) {
  let index = -1;
  for (let candidate = parts.length - 1; candidate >= 0; candidate -= 1) {
    if (predicate(parts[candidate]!)) {
      index = candidate;
      break;
    }
  }
  if (index >= 0) parts[index] = update(parts[index]!);
}

export function conversationStream(
  fullStream: AsyncIterable<unknown>,
  onEnd: Parameters<ConversationAgentRuntime["stream"]>[0]["onEnd"],
) {
  const messageId = crypto.randomUUID();
  const parts: ConversationPart[] = [];
  let finishReason: string | undefined;
  let aborted = false;
  let failed = false;
  return new ReadableStream<ConversationStreamEvent>({
    async start(controller) {
      controller.enqueue({ type: "start", messageId });
      try {
        for await (const unknownEvent of fullStream) {
          const event = unknownEvent as Record<string, unknown>;
          switch (event.type) {
            case "start-step":
              parts.push({ type: "step-start" });
              controller.enqueue({ type: "start-step" });
              break;
            case "finish-step":
              controller.enqueue({ type: "finish-step" });
              break;
            case "text-start":
            case "reasoning-start": {
              const kind = event.type === "text-start" ? "text" : "reasoning";
              parts.push({ type: kind, text: "" });
              controller.enqueue({ type: event.type, id: String(event.id) });
              break;
            }
            case "text-delta":
            case "reasoning-delta": {
              const kind = event.type === "text-delta" ? "text" : "reasoning";
              const delta = streamText(event.text);
              updatePart(parts, part => part.type === kind && part.text !== undefined,
                part => ({ ...part, text: "text" in part ? part.text + delta : delta }));
              controller.enqueue({ type: event.type, id: String(event.id), delta });
              break;
            }
            case "text-end":
            case "reasoning-end":
              controller.enqueue({ type: event.type, id: String(event.id) });
              break;
            case "tool-input-start":
              controller.enqueue({
                type: "tool-input-start",
                toolCallId: String(event.id),
                toolName: String(event.toolName),
              });
              break;
            case "tool-input-delta":
              controller.enqueue({
                type: "tool-input-delta",
                toolCallId: String(event.id),
                inputTextDelta: String(event.delta),
              });
              break;
            case "tool-call": {
              const part: ConversationPart = {
                type: "tool",
                toolName: String(event.toolName),
                toolCallId: String(event.toolCallId),
                state: "input-available",
                input: event.input,
                providerExecuted: event.providerExecuted === true || undefined,
              };
              parts.push(part);
              controller.enqueue({
                type: "tool-input-available",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                providerExecuted: part.providerExecuted,
              });
              break;
            }
            case "tool-result":
              updatePart(parts, part => part.type === "tool" && part.toolCallId === event.toolCallId,
                part => part.type === "tool" ? { ...part, state: "output-available", output: event.output } : part);
              controller.enqueue({
                type: "tool-output-available",
                toolCallId: String(event.toolCallId),
                output: event.output,
                providerExecuted: event.providerExecuted === true || undefined,
              });
              break;
            case "tool-error": {
              const errorText = safeAgentError(event.error);
              updatePart(parts, part => part.type === "tool" && part.toolCallId === event.toolCallId,
                part => part.type === "tool" ? { ...part, state: "output-error", errorText } : part);
              controller.enqueue({ type: "tool-output-error", toolCallId: String(event.toolCallId), errorText });
              break;
            }
            case "error":
              failed = true;
              controller.enqueue({ type: "error", errorText: safeAgentError(event.error) });
              break;
            case "abort":
              aborted = true;
              break;
            case "finish":
              finishReason = typeof event.finishReason === "string" ? event.finishReason : undefined;
              controller.enqueue({ type: "finish", finishReason });
              break;
          }
        }
        await onEnd({
          responseMessage: { id: messageId, role: "assistant", parts },
          isAborted: aborted,
          finishReason: failed ? "error" : finishReason,
        });
        controller.close();
      } catch (error) {
        controller.enqueue({ type: "error", errorText: safeAgentError(error) });
        controller.close();
      }
    },
  });
}

export class GigFinderConversationRuntime implements ConversationAgentRuntime {
  constructor(private readonly options: GigFinderConversationRuntimeOptions) {}

  async stream(input: Parameters<ConversationAgentRuntime["stream"]>[0]) {
    const selectedModel = this.options.selectModel?.() ?? defaultAgentModelId;
    const logger = this.options.logger.child({ requestId: input.requestId });
    logger.debug({ event: "agent.model.selected", modelId: selectedModel }, "Selected agent model");
    const configuredCapabilities = [
      this.options.reads,
      this.options.mutations,
      this.options.toolExtensions,
    ].filter(capability => capability !== undefined).length;
    if (configuredCapabilities !== 0 && configuredCapabilities !== 3) {
      throw new Error("Agent read, mutation, and tool-extension capabilities must be configured together.");
    }
    const tools = this.options.reads && this.options.mutations && this.options.toolExtensions
      ? createGigFinderTools(
          this.options.reads,
          logger,
          this.options.mutations,
          { actor: this.options.actor ?? "GigFinderAgent", requestId: input.requestId },
          this.options.toolExtensions,
        )
      : undefined;
    const agent = new GigFinderAgent({
      profile: this.options.profile,
      model: await (this.options.modelFactory ?? createCodexLanguageModel)(selectedModel),
      logger,
      tools,
      profileDocuments: this.options.profileDocuments?.() ?? [],
      maxSteps: this.options.maxSteps,
      maxOutputTokens: this.options.maxOutputTokens,
    });
    const result = agent.respond(toModelMessages(input.messages), input.signal);
    return conversationStream(result.fullStream, input.onEnd);
  }

  async title(input: Parameters<ConversationAgentRuntime["title"]>[0]) {
    const selectedModel = this.options.selectModel?.() ?? defaultAgentModelId;
    const result = await generateText({
      model: await (this.options.modelFactory ?? createCodexLanguageModel)(selectedModel),
      system: "Create a concise title for a job-search assistant conversation. Return only the title, with at most eight words.",
      prompt: `User: ${text(input.userMessage)}\nAssistant: ${text(input.assistantMessage)}`,
      maxOutputTokens: 40,
      maxRetries: 1,
      providerOptions: { openai: { store: false } },
    });
    return result.text;
  }
}
