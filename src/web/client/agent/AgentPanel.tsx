import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  constrainAgentPanelWidth,
  maximumAgentPanelWidth,
  minimumAgentPanelWidth,
  type AgentLayout,
} from "./agent-workspace";
import {
  agentModelCatalog,
  defaultAgentModelId,
  isAgentModelId,
  type AgentModelId,
} from "../../../core/application-settings";
import {
  loadApplicationSettings,
  saveAgentModel,
} from "../data/settings";
import {
  loadConversation,
  loadConversations,
} from "../data/conversations";
import type { Conversation } from "../../../core/conversation-service";
import { currentAgentActivity, toolActivity } from "./agent-activity";
import {
  DocumentActions,
  type DocumentActionDescriptor,
} from "./DocumentActions";

const starterPrompts = [
  "What kinds of roles should I prioritize?",
  "How should I position my background?",
  "Which role categories are poor fits?",
];

const genericInterruptedResponseWarning =
  "GigFinderAgent's response was interrupted before it completed. Please retry.";
const stepLimitExhaustedWarning =
  "Processing stopped before all requested work finished. Already completed actions were retained.";

export function agentInteractionWarning({
  finishReason,
  isAbort,
  isDisconnect,
  isError,
  deliveredTextCharacters,
}: {
  finishReason?: string;
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  deliveredTextCharacters: number;
}) {
  if (!isAbort && !isDisconnect && !isError && finishReason === "tool-calls") {
    return stepLimitExhaustedWarning;
  }
  if (!isAbort && (isDisconnect || isError || deliveredTextCharacters === 0)) {
    return genericInterruptedResponseWarning;
  }
  return null;
}

function messageText(parts: UIMessage["parts"]) {
  return parts.filter(part => part.type === "text").map(part => part.text ?? "").join("");
}

const stagedAttachmentDisplayPattern = /(?:\n\n)?Attached staged document: (?:staged-document:[0-9a-f-]+|\[attached document\])/gi;

export function userMessageText(parts: UIMessage["parts"]) {
  return messageText(parts).replace(stagedAttachmentDisplayPattern, "\n\nAttached document").trim();
}

const managedDocumentReferencePattern = /^doc_[0-9a-f]+(?:-[0-9a-f]+)*$/i;
const documentTypes = new Set([
  "job_description",
  "notes",
  "interview_prep",
  "profile",
]);
const mediaTypes = new Set(["text/markdown", "text/plain"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toolName(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part)) return null;
  return part.type === "dynamic-tool"
    ? part.toolName
    : part.type.slice("tool-".length);
}

function documentActionDescriptor(output: unknown): DocumentActionDescriptor | null {
  if (!isRecord(output) || output.status !== "ok" || !isRecord(output.record)) {
    return null;
  }
  const record = output.record;
  if (
    record.storage !== "managed"
    || typeof record.reference !== "string"
    || !managedDocumentReferencePattern.test(record.reference)
    || typeof record.version !== "number"
    || !Number.isSafeInteger(record.version)
    || record.version <= 0
    || typeof record.currentVersion !== "number"
    || !Number.isSafeInteger(record.currentVersion)
    || record.currentVersion <= 0
    || record.version > record.currentVersion
    || typeof record.displayName !== "string"
    || record.displayName.trim().length === 0
    || typeof record.documentType !== "string"
    || !documentTypes.has(record.documentType)
    || typeof record.mediaType !== "string"
    || !mediaTypes.has(record.mediaType)
  ) return null;
  return {
    reference: record.reference,
    version: record.version,
    displayName: record.displayName.trim(),
    documentType: record.documentType,
    mediaType: record.mediaType as DocumentActionDescriptor["mediaType"],
  };
}

export function documentActions(parts: UIMessage["parts"]): DocumentActionDescriptor[] {
  const actions = new Map<string, DocumentActionDescriptor>();
  for (const part of parts) {
    if (
      !isToolUIPart(part)
      || toolName(part) !== "get_document"
      || part.state !== "output-available"
    ) continue;
    const action = documentActionDescriptor(part.output);
    if (action) actions.set(`${action.reference}:${action.version}`, action);
  }
  return [...actions.values()];
}

export function lastCompletedDocumentReadIndex(parts: UIMessage["parts"]) {
  let result = -1;
  parts.forEach((part, index) => {
    if (
      isToolUIPart(part)
      && toolName(part) === "get_document"
      && ["output-available", "output-error", "output-denied"].includes(part.state)
    ) result = index;
  });
  return result;
}

function MessageParts({ message }: { message: UIMessage }) {
  if (message.role === "user") return <p>{userMessageText(message.parts)}</p>;
  const actions = documentActions(message.parts);
  const actionsAfter = lastCompletedDocumentReadIndex(message.parts);
  return <div className="agent-message-parts">
    {message.parts.map((part, index) => {
      const content: ReactNode = part.type === "text" && part.text
        ? <p className="agent-answer">{part.text}</p>
        : part.type === "reasoning" && part.text
          ? <section className="agent-reasoning" aria-label="Agent reasoning">
              <strong>Reasoning</strong>
              <p>{part.text}</p>
            </section>
          : (() => {
            const activity = toolActivity(part);
            return activity
          ? <div className={`agent-tool-activity is-${activity.tone}`}>
              <i aria-hidden="true" />
              <span>{activity.label}</span>
            </div>
          : null;
          })();
      return <Fragment key={`part-${index}`}>
        {content}
        {index === actionsAfter && <DocumentActions actions={actions} />}
      </Fragment>;
    })}
  </div>;
}

export function hasSuccessfulMutation(parts: Parameters<typeof messageText>[0]) {
  return parts.some(part => {
    if (!isToolUIPart(part)) return false;
    if (part.state !== "output-available") return false;
    const output = part.output;
    return typeof output === "object"
      && output !== null
      && "status" in output
      && output.status === "ok"
      && "changeId" in output;
  });
}

export function savedUploadReferences(parts: Parameters<typeof messageText>[0]) {
  return [...new Set(parts.flatMap(part => {
    if (!isToolUIPart(part)) return [];
    const toolName = part.type === "dynamic-tool"
      ? part.toolName
      : part.type.slice("tool-".length);
    if (toolName !== "create_document") return [];
    if (part.state !== "output-available") return [];
    const output = part.output;
    return typeof output === "object"
      && output !== null
      && "status" in output
      && output.status === "ok"
      && "stagedReference" in output
      && typeof output.stagedReference === "string"
      ? [output.stagedReference]
      : [];
  }))];
}

export function hasSavedUpload(parts: Parameters<typeof messageText>[0]) {
  return savedUploadReferences(parts).length > 0;
}

interface StagedUpload {
  reference: string;
  filename: string;
  extractionWarnings: string[];
  markdownCharacters: number;
  expiresAt: string;
}

const stagedReferencePattern = /^staged-document:[0-9a-f-]+$/i;

export function parseStagedUpload(value: unknown): StagedUpload {
  if (!isRecord(value)) {
    throw new Error("The upload service returned an invalid response.");
  }
  const {
    reference,
    filename,
    extractionWarnings,
    markdownCharacters,
    expiresAt,
  } = value;
  if (
    typeof reference !== "string"
    || !stagedReferencePattern.test(reference)
    || typeof filename !== "string"
    || filename.length === 0
    || !Array.isArray(extractionWarnings)
    || !extractionWarnings.every((warning): warning is string =>
      typeof warning === "string")
    || typeof markdownCharacters !== "number"
    || !Number.isInteger(markdownCharacters)
    || markdownCharacters < 0
    || typeof expiresAt !== "string"
    || !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new Error("The upload service returned an invalid response.");
  }
  return {
    reference,
    filename,
    extractionWarnings,
    markdownCharacters,
    expiresAt,
  };
}

async function discardStagedDocument(reference: string) {
  await fetch(`/api/agent/documents/${encodeURIComponent(reference)}`, {
    method: "DELETE",
  });
}

const layoutChoices: ReadonlyArray<{
  layout: AgentLayout;
  label: string;
}> = [
  { layout: "panel", label: "Dock agent to side" },
  { layout: "full", label: "Expand agent to full screen" },
];

function LayoutIcon({ layout }: { layout: AgentLayout }) {
  if (layout === "panel") {
    return <svg aria-hidden="true" viewBox="0 0 20 20"><rect x="2.5" y="3" width="15" height="14" rx="1" /><path d="M12.5 3v14" /></svg>;
  }
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>;
}

export function AgentPanel({
  open,
  layout,
  panelWidth,
  onPanelWidthChange,
  onLayoutChange,
  onClose,
  onDataChanged,
}: {
  open: boolean;
  layout: AgentLayout;
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
  onLayoutChange: (layout: AgentLayout) => void;
  onClose: () => void;
  onDataChanged?: () => void;
}) {
  const [input, setInput] = useState("");
  const [interactionFailure, setInteractionFailure] = useState<string | null>(null);
  const [upload, setUpload] = useState<StagedUpload | null>(null);
  const [uploadingFilename, setUploadingFilename] = useState<string | null>(null);
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
  const [agentModel, setAgentModel] = useState<AgentModelId>(defaultAgentModelId);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelFailure, setModelFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const diagnosticRef = useRef<{
    sequence: number;
    startedAt: number;
    assistantTextBefore: number;
  } | null>(null);
  const sequenceRef = useRef(0);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationFailure, setConversationFailure] = useState<string | null>(null);
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/agent/messages",
    prepareSendMessagesRequest: ({ id, messages }) => ({
      body: { id, message: messages[messages.length - 1] },
    }),
  }), []);
  const {
    messages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
    clearError,
  } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    throttle: 30,
    onFinish: ({ message, isAbort, isDisconnect, isError, finishReason }) => {
      const deliveredTextCharacters = messageText(message.parts).length;
      if (hasSuccessfulMutation(message.parts)) onDataChanged?.();
      const savedReferences = savedUploadReferences(message.parts);
      const normallyCompleted = !isAbort
        && !isDisconnect
        && !isError
        && deliveredTextCharacters > 0;
      const stepLimitExhausted = !isAbort
        && !isDisconnect
        && !isError
        && finishReason === "tool-calls";
      const retained = normallyCompleted || stepLimitExhausted;
      if (retained) {
        for (const reference of savedReferences) {
          void discardStagedDocument(reference).catch(() => undefined);
        }
      }
      if (retained && savedReferences.length > 0) {
        setUpload(current => current && savedReferences.includes(current.reference)
          ? null
          : current);
      }
      if (retained) {
        void loadConversations().then(setConversations).catch(() => undefined);
      }
      setInteractionFailure(agentInteractionWarning({
        finishReason,
        isAbort,
        isDisconnect,
        isError,
        deliveredTextCharacters,
      }));
    },
    onError: () => {
      setInteractionFailure(genericInterruptedResponseWarning);
    },
  });
  const previousStatusRef = useRef(status);
  const active = status === "submitted" || status === "streaming";
  const latestMessage = messages.at(-1);
  const latestAssistantParts = status === "streaming" && latestMessage?.role === "assistant"
    ? latestMessage.parts
    : undefined;
  const stepLimitReached = !error
    && !conversationFailure
    && interactionFailure === stepLimitExhaustedWarning;
  const activity = currentAgentActivity(status, latestAssistantParts);
  const activeRef = useRef(active);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  activeRef.current = active;

  useEffect(() => {
    let mounted = true;
    void loadConversations()
      .then(async items => {
        if (!mounted) return;
        setConversations(items);
        const latest = items[0];
        if (!latest) return;
        const loaded = await loadConversation(latest.id);
        if (!mounted) return;
        setInitialMessages(loaded.messages);
        setConversationId(loaded.conversation.id);
      })
      .catch(error => {
        if (mounted) setConversationFailure(
          error instanceof Error ? error.message : "Conversations could not be loaded.",
        );
      });
    return () => { mounted = false; };
  }, []);

  const switchConversation = async (id: string) => {
    if (activeRef.current || id === conversationId) return;
    setConversationFailure(null);
    try {
      const loaded = await loadConversation(id);
      setInitialMessages(loaded.messages);
      setConversationId(id);
    } catch (error) {
      setConversationFailure(
        error instanceof Error ? error.message : "Conversation could not be loaded.",
      );
    }
  };

  const newConversation = () => {
    if (activeRef.current) return;
    setInitialMessages([]);
    setConversationId(crypto.randomUUID());
    setConversationFailure(null);
  };

  useEffect(() => {
    let mounted = true;
    void loadApplicationSettings()
      .then(settings => {
        if (mounted) setAgentModel(settings.agentModel);
      })
      .catch(error => {
        if (mounted) {
          setModelFailure(
            error instanceof Error
              ? error.message
              : "The agent model preference could not be loaded.",
          );
        }
      });
    return () => { mounted = false; };
  }, []);

  const selectAgentModel = async (nextModel: AgentModelId) => {
    if (modelSaving || nextModel === agentModel) return;
    const previousModel = agentModel;
    setAgentModel(nextModel);
    setModelFailure(null);
    setModelSaving(true);
    try {
      const settings = await saveAgentModel(nextModel);
      setAgentModel(settings.agentModel);
    } catch (error) {
      setAgentModel(previousModel);
      setModelFailure(
        error instanceof Error
          ? error.message
          : "The agent model preference could not be saved.",
      );
    } finally {
      setModelSaving(false);
    }
  };

  useEffect(() => () => {
    document.body.classList.remove("is-resizing-agent");
  }, []);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-agent");
  };

  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = resizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    onPanelWidthChange(constrainAgentPanelWidth(
      current.startWidth + current.startX - event.clientX,
      window.innerWidth,
    ));
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeRef.current = null;
    document.body.classList.remove("is-resizing-agent");
  };

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const adjustment = event.key === "ArrowLeft"
      ? 24
      : event.key === "ArrowRight"
        ? -24
        : 0;
    if (adjustment === 0) return;
    event.preventDefault();
    onPanelWidthChange(constrainAgentPanelWidth(
      panelWidth + adjustment,
      window.innerWidth,
    ));
  };

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    const diagnostic = diagnosticRef.current;
    if (!diagnostic || previousStatus === status) return;
    const elapsedMs = Math.round(performance.now() - diagnostic.startedAt);
    console.debug("[GigFinderAgent]", {
      event: "agent.ui.status.changed",
      interactionSequence: diagnostic.sequence,
      previousStatus,
      status,
      elapsedMs,
      messageCount: messages.length,
    });
    if (status === "ready" && (previousStatus === "submitted" || previousStatus === "streaming")) {
      const assistantText = messages
        .filter(message => message.role === "assistant")
        .reduce((total, message) => total + messageText(message.parts).length, 0);
      const deliveredTextCharacters = assistantText - diagnostic.assistantTextBefore;
      const completion = {
        event: "agent.ui.response.finished",
        interactionSequence: diagnostic.sequence,
        outcome: "completed",
        elapsedMs,
        deliveredTextCharacters,
        messageCount: messages.length,
      };
      if (deliveredTextCharacters === 0) {
        console.warn("[GigFinderAgent]", {
          ...completion,
          diagnostic: "completed_without_assistant_text",
        });
      } else {
        console.info("[GigFinderAgent]", completion);
      }
      diagnosticRef.current = null;
    }
  }, [messages, status]);

  useEffect(() => {
    if (!error) return;
    const diagnostic = diagnosticRef.current;
    console.error("[GigFinderAgent]", {
      event: "agent.ui.error",
      interactionSequence: diagnostic?.sequence,
      elapsedMs: diagnostic
        ? Math.round(performance.now() - diagnostic.startedAt)
        : undefined,
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }, [error]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);

  const submit = async (text = input) => {
    const value = text.trim();
    const attachedUpload = upload;
    if (
      (!value && !attachedUpload)
      || activeRef.current
      || uploadingRef.current
      || modelSaving
    ) return;
    const outgoingText = attachedUpload
      ? [value, `Attached staged document: ${attachedUpload.reference}`]
          .filter(Boolean)
          .join("\n\n")
      : value;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    diagnosticRef.current = {
      sequence,
      startedAt: performance.now(),
      assistantTextBefore: messages
        .filter(message => message.role === "assistant")
        .reduce((total, message) => total + messageText(message.parts).length, 0),
    };
    console.debug("[GigFinderAgent]", {
      event: "agent.ui.request.submitted",
      interactionSequence: sequence,
      promptCharacters: outgoingText.length,
      stagedDocumentAttached: attachedUpload !== null,
      messageCount: messages.length + 1,
    });
    clearError();
    setInteractionFailure(null);
    setInput("");
    await sendMessage({ text: outgoingText });
  };

  const retry = () => {
    if (modelSaving) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    diagnosticRef.current = {
      sequence,
      startedAt: performance.now(),
      assistantTextBefore: messages
        .filter(message => message.role === "assistant")
        .reduce((total, message) => total + messageText(message.parts).length, 0),
    };
    clearError();
    setInteractionFailure(null);
    void regenerate();
  };

  const discardUpload = async () => {
    if (activeRef.current) return;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    uploadingRef.current = false;
    setUploadingFilename(null);
    setUploadFailure(null);
    const reference = upload?.reference;
    setUpload(null);
    if (!reference) return;
    try {
      await discardStagedDocument(reference);
    } catch {
      // Staged uploads expire automatically; cancellation remains effective locally.
    }
  };

  const uploadDocument = async (file: File) => {
    if (active || uploadingFilename) return;
    if (upload) await discardUpload();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    uploadingRef.current = true;
    setUploadingFilename(file.name);
    setUploadFailure(null);
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/agent/documents", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(result) && typeof result.error === "string"
          ? result.error
          : "The document could not be uploaded.";
        throw new Error(message);
      }
      setUpload(parseStagedUpload(result));
    } catch (error) {
      if (!controller.signal.aborted) {
        setUploadFailure(
          error instanceof Error ? error.message : "The document could not be uploaded.",
        );
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      uploadingRef.current = false;
      setUploadingFilename(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <aside
      className={`agent-panel is-layout-${layout} ${open ? "is-open" : ""}`}
      data-layout={layout}
      style={{ "--agent-panel-width": `${panelWidth}px` } as React.CSSProperties}
      aria-label="GigFinder"
      aria-hidden={!open}
    >
      {layout === "panel" && (
        <div
          className="agent-resize-handle"
          role="separator"
          aria-label="Resize agent panel"
          aria-orientation="vertical"
          aria-valuemin={minimumAgentPanelWidth}
          aria-valuemax={maximumAgentPanelWidth}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={resizeWithKeyboard}
        />
      )}
      <header className="agent-panel-header">
        <div className="agent-identity">
          <span className="agent-orbit" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <span className="eyebrow">Guidance channel / conversations saved</span>
            <h2>GigFinderAgent</h2>
          </div>
        </div>
        <div className="agent-header-actions">
          <div className="agent-conversation-control">
            <select
              aria-label="Conversation"
              value={conversations.some(item => item.id === conversationId) ? conversationId : "new"}
              disabled={active}
              onChange={event => {
                if (event.target.value === "new") newConversation();
                else void switchConversation(event.target.value);
              }}
            >
              <option value="new">New conversation</option>
              {conversations.map(conversation => (
                <option key={conversation.id} value={conversation.id}>
                  {conversation.title ?? "New conversation"}
                </option>
              ))}
            </select>
            <button type="button" onClick={newConversation} disabled={active}>
              New
            </button>
          </div>
          <label className="agent-model-control">
            <span>Model</span>
            <select
              aria-label="Agent model"
              value={agentModel}
              disabled={modelSaving}
              aria-busy={modelSaving}
              onChange={event => {
                if (isAgentModelId(event.target.value)) {
                  void selectAgentModel(event.target.value);
                }
              }}
            >
              {agentModelCatalog.map(model => (
                <option key={model.id} value={model.id}>
                  {layout === "full"
                    ? model.label.replace("GPT-5.6 ", "")
                    : model.label}
                </option>
              ))}
            </select>
          </label>
          <div className="agent-layout-controls" role="group" aria-label="Agent layout">
            {layoutChoices.map(choice => (
              <button
                type="button"
                key={choice.layout}
                aria-label={choice.label}
                aria-pressed={layout === choice.layout}
                onClick={() => onLayoutChange(choice.layout)}
              >
                <LayoutIcon layout={choice.layout} />
              </button>
            ))}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close GigFinder">×</button>
          {modelFailure && (
            <span className="agent-model-error" role="alert">{modelFailure}</span>
          )}
        </div>
      </header>

      <div className="agent-messages" ref={scrollRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="agent-empty">
            <span className="agent-empty-mark" aria-hidden="true">JS</span>
            <h3>Start with the shape of the search.</h3>
            <p>Ask for positioning, role-fit guidance, decision criteria, or a practical next move.</p>
            <div className="agent-starters">
              {starterPrompts.map(prompt => (
                <button type="button" disabled={modelSaving} onClick={() => void submit(prompt)} key={prompt}>{prompt}<span>↗</span></button>
              ))}
            </div>
          </div>
        )}
        {messages.map(message => (
          <article className={`agent-message is-${message.role}`} key={message.id}>
            <header>
              <span>{message.role === "user" ? "YOU" : "AGENT"}</span>
              <i />
            </header>
            <MessageParts message={message} />
          </article>
        ))}
      </div>

      {activity && (
        <div className={`agent-thinking is-${activity.tone}`} role="status" aria-live="polite" aria-busy={active}>
          <span /><span /><span /><b>{activity.label}</b>
        </div>
      )}

      {(error || interactionFailure || conversationFailure) && (
        <div className="agent-error" role="alert">
          <span>{stepLimitReached ? "PROCESSING LIMIT REACHED" : "RESPONSE INTERRUPTED"}</span>
          <p>{conversationFailure || interactionFailure || (error ? "The GigFinderAgent could not complete that response. Please retry." : "The GigFinderAgent could not complete that response.")}</p>
          {!stepLimitReached && (
            <button type="button" onClick={retry} disabled={modelSaving}>Retry response</button>
          )}
          <button type="button" onClick={() => {
            clearError();
            setInteractionFailure(null);
          }}>Dismiss</button>
        </div>
      )}

      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="agent-upload-control">
          <input
            ref={fileInputRef}
            id="agent-document-upload"
            type="file"
            accept=".docx,.md,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,application/pdf"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void uploadDocument(file);
            }}
            disabled={!open || active || uploadingFilename !== null}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!open || active || uploadingFilename !== null}
          >Attach source <span aria-hidden="true">＋</span></button>
          <span>DOCX / MD / PDF</span>
        </div>
        {uploadingFilename && (
          <div className="agent-upload-status" role="status">
            <span><i />Converting {uploadingFilename}</span>
            <button type="button" onClick={() => void discardUpload()}>Cancel</button>
          </div>
        )}
        {upload && (
          <div className="agent-upload-status is-ready" role="status">
            <span>Staged: {upload.filename} · {upload.markdownCharacters.toLocaleString()} characters</span>
            <button
              type="button"
              onClick={() => void discardUpload()}
              disabled={active}
            >Discard</button>
            {upload.extractionWarnings.length > 0 && (
              <small>{upload.extractionWarnings.join(" ")}</small>
            )}
          </div>
        )}
        {uploadFailure && (
          <div className="agent-upload-error" role="alert">
            <span>{uploadFailure}</span>
            <button type="button" onClick={() => setUploadFailure(null)}>Dismiss</button>
          </div>
        )}
        <label htmlFor="agent-message">Message GigFinderAgent</label>
        <textarea
          id="agent-message"
          ref={inputRef}
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask about fit, positioning, or priorities…"
          rows={3}
          maxLength={8000}
          disabled={!open || uploadingFilename !== null || modelSaving}
        />
        <div className="agent-composer-footer">
          <span>{active ? "STREAM ACTIVE" : "LIVE DATA ACCESS"}</span>
          {active
            ? <button className="agent-stop" type="button" onClick={() => {
                const diagnostic = diagnosticRef.current;
                console.warn("[GigFinderAgent]", {
                  event: "agent.ui.stop.requested",
                  interactionSequence: diagnostic?.sequence,
                  elapsedMs: diagnostic
                    ? Math.round(performance.now() - diagnostic.startedAt)
                    : undefined,
                  status,
                });
                void stop();
              }}>Stop <i /></button>
            : <button className="agent-send" type="submit" disabled={modelSaving || (!input.trim() && !upload)}>Send <span>↗</span></button>}
        </div>
      </form>
    </aside>
  );
}

export function AgentLauncher({
  open,
  layout,
  onClick,
}: {
  open: boolean;
  layout: AgentLayout;
  onClick: () => void;
}) {
  return (
    <button className={`agent-launcher ${open ? "is-active" : ""} is-layout-${layout}`} type="button" onClick={onClick} aria-expanded={open} aria-controls="gig-finder-agent">
      <span className="agent-launcher-signal"><i /></span>
      <span><small>ADVISORY CHANNEL</small>Ask GigFinderAgent</span>
      <b>{open ? "×" : "↗"}</b>
    </button>
  );
}
