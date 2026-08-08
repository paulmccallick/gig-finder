import {
  isStepCount,
  streamText,
  type ModelMessage,
} from "ai";
import {
  buildCurrentTurnContext,
  buildGigFinderInstructions,
} from "./system-prompt";
import type { GigFinderAgentOptions } from "./types";

type StepStartLogEvent = {
  callId: string; stepNumber: number; provider: string; modelId: string;
  tools: Record<string, unknown> | undefined; steps: readonly unknown[];
};
type LoggedToolCall = { toolCallId: string; toolName: string; input?: unknown };
type StepEndLogEvent = {
  callId: string; stepNumber: number; model: { provider: string; modelId: string };
  usage: {
    inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined;
    inputTokenDetails: { cacheReadTokens: number | undefined };
    outputTokenDetails: { reasoningTokens: number | undefined };
  };
  finishReason: unknown; toolCalls: readonly (LoggedToolCall | undefined)[];
  toolResults: readonly ({ toolCallId: string; toolName: string } | undefined)[];
  performance: {
    stepTimeMs: number; responseTimeMs: number;
    timeToFirstOutputMs: number | undefined;
    toolExecutionMs: Readonly<Record<string, number>>;
  };
  text: string; reasoningText?: string;
};
type EndLogEvent = Pick<StepEndLogEvent, "usage" | "finishReason"> & {
  steps: readonly { text: string; toolCalls: readonly unknown[] }[];
};

function textCharacters(messages: ModelMessage[]) {
  return messages.reduce((total, message) => {
    if (typeof message.content === "string") return total + message.content.length;
    return total + message.content.reduce((partTotal, part) => (
      part.type === "text" ? partTotal + part.text.length : partTotal
    ), 0);
  }, 0);
}

export class GigFinderAgent {
  constructor(private readonly options: GigFinderAgentOptions) {}

  respond(messages: ModelMessage[], signal?: AbortSignal) {
    const startedAt = performance.now();
    let activeStep: {
      callId: string;
      stepNumber: number;
      startedAt: number;
    } | null = null;
    let wasAborted = false;
    const log = this.options.logger;
    const model = this.options.model;
    const now = this.options.now?.() ?? new Date();
    const instructions = `${buildGigFinderInstructions(this.options.profile, {
      liveRecords: this.options.tools !== undefined,
      profileDocuments: this.options.profileDocuments,
    })}\n\n${buildCurrentTurnContext(now)}`;
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
      instructions,
      messages,
      tools: this.options.tools,
      stopWhen: isStepCount(5),
      abortSignal: signal,
      maxRetries: 1,
      providerOptions: {
        openai: {
          store: false,
          reasoningSummary: "auto",
        },
      },
      onStepStart: ({ callId, stepNumber, provider, modelId, tools, steps }: StepStartLogEvent) => {
        activeStep = { callId, stepNumber, startedAt: performance.now() };
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
        text,
        reasoningText,
      }: StepEndLogEvent) => {
        log.debug({
          ...interaction,
          event: "agent.step.completed",
          callId,
          stepNumber,
          provider: stepModel.provider,
          modelId: stepModel.modelId,
          latencyMs: performance.stepTimeMs,
          responseTimeMs: performance.responseTimeMs,
          timeToFirstOutputMs: performance.timeToFirstOutputMs,
          textCharacters: text.length,
          reasoningCharacters: reasoningText?.length ?? 0,
          modelOutput: {
            text,
            reasoning: reasoningText ?? null,
            toolCalls: toolCalls.filter(toolCall => toolCall !== undefined).map(toolCall => ({
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            })),
          },
          finishReason,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
          },
          toolCalls: toolCalls.filter(call => call !== undefined).map(call => ({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
          })),
          toolResults: toolResults.filter(result => result !== undefined).map(result => ({
            toolCallId: result.toolCallId,
            toolName: result.toolName,
          })),
          toolExecutionMs: performance.toolExecutionMs,
        }, "Completed agent step");
        activeStep = null;
      },
      onEnd: ({ usage, finishReason, steps }: EndLogEvent) => {
        const outcome = wasAborted ? "aborted" : "completed";
        log.info({
          ...interaction,
          event: "model.interaction.finished",
          outcome,
          latencyMs: Math.round(performance.now() - startedAt),
          finishReason,
          stepCount: steps.length,
          textCharactersGenerated: steps.reduce(
            (total, step) => total + step.text.length,
            0,
          ),
          toolCallCount: steps.reduce(
            (total, step) => total + step.toolCalls.length,
            0,
          ),
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
            reasoningTokens: usage.outputTokenDetails.reasoningTokens,
          },
        }, `${outcome === "aborted" ? "Aborted" : "Completed"} model interaction`);
      },
      onAbort: ({ steps }: { steps: readonly unknown[] }) => {
        wasAborted = true;
        log.warn({
          ...interaction,
          event: "model.interaction.aborted",
          callId: activeStep?.callId,
          latencyMs: Math.round(performance.now() - startedAt),
          completedStepCount: steps.length,
          activeStepNumber: activeStep?.stepNumber,
          activeStepAgeMs: activeStep
            ? Math.round(performance.now() - activeStep.startedAt)
            : undefined,
          abortSource: signal?.aborted ? "request_signal" : "stream",
          signalAborted: signal?.aborted ?? false,
          err: signal?.reason,
        }, "Model interaction aborted");
      },
      onError: ({ error }: { error: unknown }) => {
        log.error({
          ...interaction,
          event: "model.interaction.failed",
          latencyMs: Math.round(performance.now() - startedAt),
          activeStepNumber: activeStep?.stepNumber,
          activeStepAgeMs: activeStep
            ? Math.round(performance.now() - activeStep.startedAt)
            : undefined,
          err: error,
        }, "Model interaction failed");
      },
    });
    return result;
  }
}
