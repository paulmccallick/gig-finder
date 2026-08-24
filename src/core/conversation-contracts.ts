export type ConversationRole = "user" | "assistant";

export type ConversationPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "attachment"; reference: string }
  | { type: "step-start" }
  | { type: "tool"; toolName: string; toolCallId: string; state: "input-available" | "output-available" | "output-error"; input: unknown; output?: unknown; errorText?: string; providerExecuted?: boolean };

export interface ConversationMessage { id: string; role: ConversationRole; parts: ConversationPart[] }

export type ConversationStreamEvent =
  | { type: "start"; messageId: string }
  | { type: "start-step" }
  | { type: "finish-step" }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown; providerExecuted?: boolean }
  | { type: "tool-output-available"; toolCallId: string; output: unknown; providerExecuted?: boolean }
  | { type: "tool-output-error"; toolCallId: string; errorText: string; providerExecuted?: boolean }
  | { type: "finish"; finishReason?: string }
  | { type: "error"; errorText: string };

export interface Conversation { id: string; title: string | null; createdAt: string; lastActiveAt: string }
export interface ConversationRepository {
  listRecent(limit: number): Conversation[];
  get(id: string): Conversation | null;
  messages(id: string): ConversationMessage[];
  saveTurn(input: { conversationId: string; title: string; userMessage: ConversationMessage; assistantMessage: ConversationMessage; occurredAt: string }): void;
}
export interface ConversationDocumentAccess { read(documentId: string, version: number | null): Promise<unknown | null> }
export interface ConversationAgentRuntime {
  stream(input: { messages: ConversationMessage[]; requestId: string; signal?: AbortSignal; onEnd: (event: { responseMessage: ConversationMessage; isAborted: boolean; finishReason?: string }) => PromiseLike<void> | void }): Promise<ReadableStream<ConversationStreamEvent>>;
  title(input: { userMessage: ConversationMessage; assistantMessage: ConversationMessage }): Promise<string>;
}
