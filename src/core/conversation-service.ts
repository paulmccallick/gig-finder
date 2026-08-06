import { isStagedDocumentReference } from "./staged-documents";

export type ConversationRole = "user" | "assistant";

export type ConversationPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "attachment"; reference: string }
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

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const internalIdentifierPatterns: ReadonlyArray<[RegExp, string]> = [
  [new RegExp(`\\bstaged-document:${uuid}\\b`, "gi"), "[attached document]"],
  [new RegExp(`\\bdoc_${uuid}\\b`, "gi"), "[document]"],
  [new RegExp(`\\b(?:gig|person|task|meeting|gig_person|relationship)_${uuid}\\b`, "gi"), "[record]"],
  [/\bagent-(?:tool|revert):[A-Za-z0-9][A-Za-z0-9:_-]{2,200}\b/gi, "[change]"],
  [/\b(?:tool(?:[- ]call)?|change|document|record|gig|person|task|meeting|relationship)\s+ID\s*(?:is|=|:|#)?\s*["']?[A-Za-z0-9][A-Za-z0-9:_-]{2,200}["']?/gi, "[internal identifier]"],
  [/\b(?:call|toolu)_[A-Za-z0-9][A-Za-z0-9_-]{7,200}\b/g, "[tool call]"],
];

export function sanitizeConversationText(value: string) {
  return internalIdentifierPatterns.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

export function sanitizeConversationMessage(message: ConversationMessage): ConversationMessage {
  return {
    ...message,
    parts: message.parts.map(part => part.type === "text" || part.type === "reasoning"
      ? { ...part, text: sanitizeConversationText(part.text) }
      : part),
  };
}

const stagedReferenceCandidatePattern = /\bstaged-document:[A-Za-z0-9-]+\b/g;

function userMessageForPersistence(message: ConversationMessage): ConversationMessage {
  const references = message.parts.flatMap(part => part.type === "text"
    ? [...part.text.matchAll(stagedReferenceCandidatePattern)]
        .map(match => match[0])
        .filter(isStagedDocumentReference)
    : []);
  const sanitized = sanitizeConversationMessage(message);
  return {
    ...sanitized,
    parts: [
      ...sanitized.parts,
      ...[...new Set(references)].map(reference => ({
        type: "attachment" as const,
        reference,
      })),
    ],
  };
}

function attachmentsForModel(messages: ConversationMessage[]) {
  return messages.map(message => ({
    ...message,
    parts: message.parts.map(part => part.type === "attachment"
      ? { type: "text" as const, text: `Internal staged attachment reference: ${part.reference}` }
      : part),
  }));
}

function sanitizeConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    title: conversation.title === null ? null : sanitizeConversationText(conversation.title),
  };
}

const streamingSanitizerTailTokens = 6;

function stableStreamingPrefixCharacters(value: string) {
  const starts = [...value.matchAll(/\S+/g)].map(match => match.index);
  return starts.length > streamingSanitizerTailTokens
    ? starts[starts.length - streamingSanitizerTailTokens] ?? 0
    : 0;
}

function sanitizeConversationStream(stream: ReadableStream<ConversationStreamEvent>) {
  const pending = new Map<string, string>();
  const keyFor = (kind: "text" | "reasoning", id: string) => `${kind}:${id}`;
  const flush = (
    controller: TransformStreamDefaultController<ConversationStreamEvent>,
    kind: "text" | "reasoning",
    id: string,
    final: boolean,
  ) => {
    const key = keyFor(kind, id);
    const value = pending.get(key) ?? "";
    const emitCharacters = final ? value.length : stableStreamingPrefixCharacters(value);
    if (emitCharacters === 0) return;
    const emit = value.slice(0, emitCharacters);
    pending.set(key, value.slice(emitCharacters));
    controller.enqueue({
      type: `${kind}-delta`,
      id,
      delta: sanitizeConversationText(emit),
    });
    if (final) pending.delete(key);
  };
  const flushAll = (controller: TransformStreamDefaultController<ConversationStreamEvent>) => {
    for (const key of [...pending.keys()]) {
      const separator = key.indexOf(":");
      const kind = key.slice(0, separator) as "text" | "reasoning";
      flush(controller, kind, key.slice(separator + 1), true);
    }
  };
  return stream.pipeThrough(new TransformStream<ConversationStreamEvent, ConversationStreamEvent>({
    transform(event, controller) {
      if (event.type === "text-start" || event.type === "reasoning-start") {
        const kind = event.type === "text-start" ? "text" : "reasoning";
        pending.set(keyFor(kind, event.id), "");
        controller.enqueue(event);
        return;
      }
      if (event.type === "text-delta" || event.type === "reasoning-delta") {
        const kind = event.type === "text-delta" ? "text" : "reasoning";
        const key = keyFor(kind, event.id);
        pending.set(key, `${pending.get(key) ?? ""}${event.delta}`);
        flush(controller, kind, event.id, false);
        return;
      }
      if (event.type === "text-end" || event.type === "reasoning-end") {
        const kind = event.type === "text-end" ? "text" : "reasoning";
        flush(controller, kind, event.id, true);
        controller.enqueue(event);
        return;
      }
      if (event.type === "finish" || event.type === "error") flushAll(controller);
      controller.enqueue(event);
    },
    flush(controller) {
      flushAll(controller);
    },
  }));
}

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
  const sanitized = sanitizeConversationMessage(message);
  return {
    ...sanitized,
    parts: sanitized.parts.map(part => {
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
    ).map(sanitizeConversation);
  }

  load(id: string) {
    const conversation = this.repository.get(id);
    return conversation ? {
      conversation: sanitizeConversation(conversation),
      messages: this.repository.messages(id).map(sanitizeConversationMessage),
    } : null;
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
    const stored = existing
      ? this.repository.messages(input.conversationId).map(sanitizeConversationMessage)
      : [];
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
    const modelMessages = latestCompleteTurns(
      attachmentsForModel(hydrated),
      characterBudget,
    );
    const stream = await this.runtime.stream({
      messages: modelMessages,
      requestId: input.requestId,
      signal: input.signal,
      onEnd: async ({ responseMessage, isAborted, finishReason }) => {
        if (isAborted || finishReason === "error") return;
        const persisted = compactMessageForPersistence(responseMessage);
        const fallback = sanitizeConversationText(fallbackTitle(userMessage));
        let title = existing?.title ? sanitizeConversationText(existing.title) : fallback;
        if (!existing) {
          try {
            title = cleanTitle(
              sanitizeConversationText(
                await this.runtime.title({ userMessage, assistantMessage: persisted }),
              ),
              fallback,
            );
          } catch {
            title = fallback;
          }
        }
        this.repository.saveTurn({
          conversationId: input.conversationId,
          title,
          userMessage: userMessageForPersistence(userMessage),
          assistantMessage: persisted,
          occurredAt: new Date().toISOString(),
        });
      },
    });
    return sanitizeConversationStream(stream);
  }
}

function isConversationPart(value: unknown): value is ConversationPart {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string";
  if (value.type === "attachment") {
    return typeof value.reference === "string"
      && isStagedDocumentReference(value.reference);
  }
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
