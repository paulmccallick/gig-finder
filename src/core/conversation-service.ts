export type ConversationRole = "user" | "assistant";

export type ConversationPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "step-start" }
  | {
      type: "tool";
      toolName: string;
      toolCallId: string;
      state: "input-available" | "output-available" | "output-error";
      input: unknown;
      output?: unknown;
      errorText?: string;
      providerExecuted?: boolean;
    };

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  parts: ConversationPart[];
}

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

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface ConversationRepository {
  listRecent(limit: number): Conversation[];
  get(id: string): Conversation | null;
  messages(id: string): ConversationMessage[];
  saveTurn(input: {
    conversationId: string;
    title: string;
    userMessage: ConversationMessage;
    assistantMessage: ConversationMessage;
    occurredAt: string;
  }): void;
}

export interface ConversationDocumentAccess {
  read(documentId: string, version: number | null): Promise<unknown | null>;
}

export interface ConversationAgentRuntime {
  stream(input: {
    messages: ConversationMessage[];
    requestId: string;
    signal?: AbortSignal;
    onEnd: (event: {
      responseMessage: ConversationMessage;
      isAborted: boolean;
      finishReason?: string;
    }) => PromiseLike<void> | void;
  }): Promise<ReadableStream<ConversationStreamEvent>>;
  title(input: { userMessage: ConversationMessage; assistantMessage: ConversationMessage }): Promise<string>;
}

export class ConversationValidationError extends Error {}

const defaults = {
  recentConversationLimit: 20,
  maxUserTextCharacters: 8_000,
  maxInputTokens: 64_000,
  reservedTokens: 12_000,
  nonHistoryTokens: 12_000,
  charactersPerToken: 4,
  maxPersistedToolResultCharacters: 16_000,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function messageText(message: ConversationMessage) {
  return message.parts
    .filter(part => part.type === "text")
    .map(part => part.text)
    .join("");
}

function compactToolOutput(output: unknown, maxCharacters: number) {
  const serialized = JSON.stringify(output);
  if (serialized.length <= maxCharacters) return output;
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, maxCharacters),
  };
}

export function compactMessageForPersistence(
  message: ConversationMessage,
  maxToolResultCharacters = defaults.maxPersistedToolResultCharacters,
): ConversationMessage {
  return {
    ...message,
    parts: message.parts.map(part => {
      if (part.type !== "tool" || part.state !== "output-available") {
        return part;
      }
      const output = part.output;
      if (part.toolName === "get_document" && isRecord(output)) {
        const record = isRecord(output.record) ? output.record : null;
        const documentId = record && typeof record.reference === "string"
          ? record.reference
          : null;
        const version = record && typeof record.version === "number"
          ? record.version
          : record && typeof record.currentVersion === "number"
            ? record.currentVersion
          : null;
        if (documentId) return { ...part, output: { documentId, version } };
      }
      return { ...part, output: compactToolOutput(output, maxToolResultCharacters) };
    }),
  };
}

function messageCharacters(message: ConversationMessage) {
  return JSON.stringify(message).length;
}

function latestCompleteTurns(messages: ConversationMessage[], characterBudget: number) {
  const selected: ConversationMessage[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const size = messageCharacters(message);
    if (selected.length > 0 && characters + size > characterBudget) break;
    selected.unshift(message);
    characters += size;
  }
  while (selected[0]?.role === "assistant") selected.shift();
  return selected;
}

async function hydrateLatestDocuments(
  messages: ConversationMessage[],
  documents: ConversationDocumentAccess,
) {
  const latest = new Map<string, { messageIndex: number; partIndex: number; version: number | null }>();
  messages.forEach((message, messageIndex) => message.parts.forEach((part, partIndex) => {
    if (part.type !== "tool" || part.toolName !== "get_document" || !isRecord(part.output)) return;
    const documentId = typeof part.output.documentId === "string" ? part.output.documentId : null;
    const version = typeof part.output.version === "number" ? part.output.version : null;
    if (documentId) latest.set(documentId, { messageIndex, partIndex, version });
  }));
  const hydrated = messages.map(message => ({ ...message, parts: [...message.parts] }));
  await Promise.all([...latest.entries()].map(async ([documentId, location]) => {
    const content = await documents.read(documentId, location.version);
    if (content === null) return;
    const message = hydrated[location.messageIndex]!;
    const part = message.parts[location.partIndex]!;
    message.parts[location.partIndex] = {
      ...part,
      output: content,
    } as typeof part;
  }));
  return hydrated;
}

function fallbackTitle(message: ConversationMessage) {
  const text = messageText(message).replace(/\s+/g, " ").trim();
  return (text || "New conversation").slice(0, 80);
}

function cleanTitle(value: string, fallback: string) {
  const title = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/^["']|["']$/g, "");
  return (title || fallback).slice(0, 80);
}

export class ConversationService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly documents: ConversationDocumentAccess,
    private readonly runtime: ConversationAgentRuntime,
    private readonly options: Partial<typeof defaults> = {},
  ) {}

  list() {
    return this.repository.listRecent(
      this.options.recentConversationLimit ?? defaults.recentConversationLimit,
    );
  }

  load(id: string) {
    const conversation = this.repository.get(id);
    return conversation ? { conversation, messages: this.repository.messages(id) } : null;
  }

  async respond(input: {
    conversationId: string;
    message: unknown;
    requestId: string;
    signal?: AbortSignal;
  }) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.conversationId)) {
      throw new ConversationValidationError("Invalid conversation ID.");
    }
    if (!isConversationMessage(input.message) || input.message.role !== "user") {
      throw new ConversationValidationError("A valid user message is required.");
    }
    const userMessage = input.message;
    const maxText = this.options.maxUserTextCharacters ?? defaults.maxUserTextCharacters;
    if (messageText(userMessage).length > maxText) {
      throw new ConversationValidationError(`A message is limited to ${maxText} characters.`);
    }
    const existing = this.repository.get(input.conversationId);
    const stored = existing ? this.repository.messages(input.conversationId) : [];
    const history = [...stored, userMessage];
    if (!history.every(isConversationMessage)) {
      throw new ConversationValidationError("Stored conversation history is invalid.");
    }
    const tokenBudget = (this.options.maxInputTokens ?? defaults.maxInputTokens)
      - (this.options.reservedTokens ?? defaults.reservedTokens)
      - (this.options.nonHistoryTokens ?? defaults.nonHistoryTokens);
    const characterBudget = Math.max(1, tokenBudget)
      * (this.options.charactersPerToken ?? defaults.charactersPerToken);
    const selected = latestCompleteTurns(history, characterBudget);
    const hydrated = await hydrateLatestDocuments(selected, this.documents);
    const modelMessages = latestCompleteTurns(hydrated, characterBudget);
    return this.runtime.stream({
      messages: modelMessages,
      requestId: input.requestId,
      signal: input.signal,
      onEnd: async ({ responseMessage, isAborted, finishReason }) => {
        if (isAborted || finishReason === "error") return;
        const persisted = compactMessageForPersistence(responseMessage);
        const fallback = fallbackTitle(userMessage);
        let title = existing?.title ?? fallback;
        if (!existing) {
          try {
            title = cleanTitle(
              await this.runtime.title({ userMessage, assistantMessage: persisted }),
              fallback,
            );
          } catch {
            title = fallback;
          }
        }
        this.repository.saveTurn({
          conversationId: input.conversationId,
          title,
          userMessage,
          assistantMessage: persisted,
          occurredAt: new Date().toISOString(),
        });
      },
    });
  }
}

function isConversationPart(value: unknown): value is ConversationPart {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string";
  if (value.type === "step-start") return true;
  if (value.type !== "tool") return false;
  return typeof value.toolName === "string"
    && typeof value.toolCallId === "string"
    && ["input-available", "output-available", "output-error"].includes(String(value.state));
}

export function isConversationMessage(value: unknown): value is ConversationMessage {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.role === "user" || value.role === "assistant")
    && Array.isArray(value.parts)
    && value.parts.every(isConversationPart);
}
