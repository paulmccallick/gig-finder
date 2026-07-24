import {
  streamText,
  type ModelMessage,
} from "ai";
import { logger as defaultLogger } from "../observability/logger";
import { buildJobSearchInstructions } from "./system-prompt";
import type { JobSearchAgentOptions } from "./types";

function textCharacters(messages: ModelMessage[]) {
  return messages.reduce((total, message) => {
    if (typeof message.content === "string") return total + message.content.length;
    return total + message.content.reduce((partTotal, part) => (
      part.type === "text" ? partTotal + part.text.length : partTotal
    ), 0);
  }, 0);
}

export class JobSearchAgent {
  constructor(private readonly options: JobSearchAgentOptions) {}

  respond(messages: ModelMessage[], signal?: AbortSignal) {
    const startedAt = performance.now();
    const log = this.options.logger ?? defaultLogger;
    const model = this.options.model;
    const modelIdentity = typeof model === "string"
      ? { provider: "registry", modelId: model }
      : { provider: model.provider, modelId: model.modelId };
    const interaction = {
      event: "model.interaction",
      ...modelIdentity,
      messageCount: messages.length,
      messageRoles: messages.map(message => message.role),
      textCharacters: textCharacters(messages),
    };

    log.debug(interaction, "Starting model interaction");
    const result = streamText({
      model,
      instructions: buildJobSearchInstructions(this.options.profile),
      messages,
      abortSignal: signal,
      maxRetries: 1,
      providerOptions: {
        openai: {
          store: false,
          reasoningSummary: "auto",
        },
      },
      onStepStart: ({ callId, stepNumber, provider, modelId, tools, steps }) => {
        log.debug({
          ...interaction,
          event: "agent.step.started",
          callId,
          stepNumber,
          provider,
          modelId,
          previousStepCount: steps.length,
          availableTools: tools ? Object.keys(tools) : [],
        }, "Starting agent step");
      },
      onStepEnd: ({
        callId,
        stepNumber,
        model: stepModel,
        usage,
        finishReason,
        toolCalls,
        toolResults,
        performance,
      }) => {
        log.debug({
          ...interaction,
          event: "agent.step.completed",
          callId,
          stepNumber,
          provider: stepModel.provider,
          modelId: stepModel.modelId,
          latencyMs: performance.stepTimeMs,
          responseTimeMs: performance.responseTimeMs,
          finishReason,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
          },
          toolCalls: toolCalls.map(call => ({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
          })),
          toolResults: toolResults.map(result => ({
            toolCallId: result.toolCallId,
            toolName: result.toolName,
          })),
          toolExecutionMs: performance.toolExecutionMs,
        }, "Completed agent step");
      },
      onEnd: ({ usage, finishReason, steps }) => {
        log.info({
          ...interaction,
          event: "model.interaction.completed",
          latencyMs: Math.round(performance.now() - startedAt),
          finishReason,
          stepCount: steps.length,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
          },
        }, "Completed model interaction");
      },
      onAbort: () => {
        log.warn({
          ...interaction,
          event: "model.interaction.aborted",
          latencyMs: Math.round(performance.now() - startedAt),
        }, "Model interaction aborted");
      },
      onError: ({ error }) => {
        log.error({
          ...interaction,
          event: "model.interaction.failed",
          latencyMs: Math.round(performance.now() - startedAt),
          err: error,
        }, "Model interaction failed");
      },
    });
    return result;
  }
}
