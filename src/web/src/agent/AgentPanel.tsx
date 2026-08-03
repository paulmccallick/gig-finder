import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
} from "../../../core/src/application-settings";
import {
  loadApplicationSettings,
  saveAgentModel,
} from "../data/settings";

const starterPrompts = [
  "What kinds of roles should I prioritize?",
  "How should I position my background?",
  "Which role categories are poor fits?",
];

function messageText(parts: UIMessage["parts"]) {
  return parts.filter(part => part.type === "text").map(part => part.text ?? "").join("");
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/agent/messages" }), []);
  const {
    messages,
    sendMessage,
    stop,
    regenerate,
    status,
    error,
    clearError,
  } = useChat({
    transport,
    throttle: 30,
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      const deliveredTextCharacters = messageText(message.parts).length;
      if (hasSuccessfulMutation(message.parts)) onDataChanged?.();
      const savedReferences = savedUploadReferences(message.parts);
      const completed = !isAbort
        && !isDisconnect
        && !isError
        && deliveredTextCharacters > 0;
      if (completed) {
        for (const reference of savedReferences) {
          void discardStagedDocument(reference).catch(() => undefined);
        }
      }
      if (completed && savedReferences.length > 0) {
        setUpload(current => current && savedReferences.includes(current.reference)
          ? null
          : current);
      }
      if (!isAbort && (isDisconnect || isError || deliveredTextCharacters === 0)) {
        setInteractionFailure(
          "GigFinderAgent's response was interrupted before it completed. Please retry.",
        );
      }
    },
    onError: () => {
      setInteractionFailure(
        "GigFinderAgent's response was interrupted before it completed. Please retry.",
      );
    },
  });
  const previousStatusRef = useRef(status);
  const active = status === "submitted" || status === "streaming";
  const activeRef = useRef(active);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  activeRef.current = active;

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
            <span className="eyebrow">Guidance channel / session only</span>
            <h2>GigFinderAgent</h2>
          </div>
        </div>
        <div className="agent-header-actions">
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

      <div className="agent-messages" ref={scrollRef} aria-live="polite" aria-busy={active}>
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
            <p>{messageText(message.parts)}</p>
          </article>
        ))}
        {status === "submitted" && (
          <div className="agent-thinking"><span /><span /><span /><b>ASSESSING SEARCH CONTEXT</b></div>
        )}
      </div>

      {(error || interactionFailure) && (
        <div className="agent-error" role="alert">
          <span>RESPONSE INTERRUPTED</span>
          <p>{interactionFailure || error?.message || "The GigFinderAgent could not complete that response."}</p>
          <button type="button" onClick={retry} disabled={modelSaving}>Retry response</button>
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
                stop();
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
