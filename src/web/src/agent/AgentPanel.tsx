import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

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

function hasSavedUpload(parts: Parameters<typeof messageText>[0]) {
  return parts.some(part => {
    if (!isToolUIPart(part)) return false;
    const toolName = part.type === "dynamic-tool"
      ? part.toolName
      : part.type.slice("tool-".length);
    if (toolName !== "create_uploaded_document") return false;
    if (part.state !== "output-available") return false;
    const output = part.output;
    return typeof output === "object"
      && output !== null
      && "status" in output
      && output.status === "ok";
  });
}

interface StagedUpload {
  reference: string;
  filename: string;
  extractionWarnings: string[];
  markdownCharacters: number;
  expiresAt: string;
}

export function AgentPanel({
  open,
  onClose,
  onDataChanged,
}: {
  open: boolean;
  onClose: () => void;
  onDataChanged?: () => void;
}) {
  const [input, setInput] = useState("");
  const [interactionFailure, setInteractionFailure] = useState<string | null>(null);
  const [upload, setUpload] = useState<StagedUpload | null>(null);
  const [uploadingFilename, setUploadingFilename] = useState<string | null>(null);
  const [uploadFailure, setUploadFailure] = useState<string | null>(null);
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
      if (hasSavedUpload(message.parts)) setUpload(null);
      if (!isAbort && (isDisconnect || isError || deliveredTextCharacters === 0)) {
        setInteractionFailure(
          "JobSearchAgent's response was interrupted before it completed. Please retry.",
        );
      }
    },
    onError: () => {
      setInteractionFailure(
        "JobSearchAgent's response was interrupted before it completed. Please retry.",
      );
    },
  });
  const previousStatusRef = useRef(status);
  const active = status === "submitted" || status === "streaming";
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    const diagnostic = diagnosticRef.current;
    if (!diagnostic || previousStatus === status) return;
    const elapsedMs = Math.round(performance.now() - diagnostic.startedAt);
    console.debug("[JobSearchAgent]", {
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
        console.warn("[JobSearchAgent]", {
          ...completion,
          diagnostic: "completed_without_assistant_text",
        });
      } else {
        console.info("[JobSearchAgent]", completion);
      }
      diagnosticRef.current = null;
    }
  }, [messages, status]);

  useEffect(() => {
    if (!error) return;
    const diagnostic = diagnosticRef.current;
    console.error("[JobSearchAgent]", {
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

  const submit = async (text = input, allowDuringUpload = false) => {
    const value = text.trim();
    if (!value || activeRef.current || (uploadingRef.current && !allowDuringUpload)) return;
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    diagnosticRef.current = {
      sequence,
      startedAt: performance.now(),
      assistantTextBefore: messages
        .filter(message => message.role === "assistant")
        .reduce((total, message) => total + messageText(message.parts).length, 0),
    };
    console.debug("[JobSearchAgent]", {
      event: "agent.ui.request.submitted",
      interactionSequence: sequence,
      promptCharacters: value.length,
      messageCount: messages.length + 1,
    });
    clearError();
    setInteractionFailure(null);
    setInput("");
    await sendMessage({ text: value });
  };

  const retry = () => {
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
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    uploadingRef.current = false;
    setUploadingFilename(null);
    setUploadFailure(null);
    const reference = upload?.reference;
    setUpload(null);
    if (!reference) return;
    try {
      await fetch(`/api/agent/documents/${encodeURIComponent(reference)}`, {
        method: "DELETE",
      });
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
      const result = await response.json() as StagedUpload | { error?: unknown };
      if (!response.ok || !("reference" in result)) {
        const message = "error" in result && typeof result.error === "string"
          ? result.error
          : "The document could not be uploaded.";
        throw new Error(message);
      }
      setUpload(result);
      await submit(
        `The web application staged a source document as ${result.reference}. Process this upload using the uploaded-source workflow.`,
        true,
      );
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
    <aside className={`agent-panel ${open ? "is-open" : ""}`} aria-label="Job Search Agent" aria-hidden={!open}>
      <header className="agent-panel-header">
        <div className="agent-identity">
          <span className="agent-orbit" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <span className="eyebrow">Guidance channel / session only</span>
            <h2>JobSearchAgent</h2>
          </div>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close Job Search Agent">×</button>
      </header>

      <div className="agent-boundary" role="note">
        <span>CONTEXT 01</span>
        <p>I understand your target roles, strengths, constraints, and search strategy. I can read your applications, contacts, tasks, and registered documents; update existing jobs and contacts; and create or revise job documents when asked.</p>
      </div>

      <div className="agent-messages" ref={scrollRef} aria-live="polite" aria-busy={active}>
        {messages.length === 0 && (
          <div className="agent-empty">
            <span className="agent-empty-mark" aria-hidden="true">JS</span>
            <h3>Start with the shape of the search.</h3>
            <p>Ask for positioning, role-fit guidance, decision criteria, or a practical next move.</p>
            <div className="agent-starters">
              {starterPrompts.map(prompt => (
                <button type="button" onClick={() => void submit(prompt)} key={prompt}>{prompt}<span>↗</span></button>
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
          <p>{interactionFailure || error?.message || "The JobSearchAgent could not complete that response."}</p>
          <button type="button" onClick={retry}>Retry response</button>
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
            <button type="button" onClick={() => void discardUpload()}>Discard</button>
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
        <label htmlFor="agent-message">Message JobSearchAgent</label>
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
          disabled={!open || uploadingFilename !== null}
        />
        <div className="agent-composer-footer">
          <span>{active ? "STREAM ACTIVE" : "LIVE DATA ACCESS"}</span>
          {active
            ? <button className="agent-stop" type="button" onClick={() => {
                const diagnostic = diagnosticRef.current;
                console.warn("[JobSearchAgent]", {
                  event: "agent.ui.stop.requested",
                  interactionSequence: diagnostic?.sequence,
                  elapsedMs: diagnostic
                    ? Math.round(performance.now() - diagnostic.startedAt)
                    : undefined,
                  status,
                });
                stop();
              }}>Stop <i /></button>
            : <button className="agent-send" type="submit" disabled={!input.trim()}>Send <span>↗</span></button>}
        </div>
      </form>
    </aside>
  );
}

export function AgentLauncher({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className={`agent-launcher ${open ? "is-active" : ""}`} type="button" onClick={onClick} aria-expanded={open} aria-controls="job-search-agent">
      <span className="agent-launcher-signal"><i /></span>
      <span><small>ADVISORY CHANNEL</small>Ask JobSearchAgent</span>
      <b>{open ? "×" : "↗"}</b>
    </button>
  );
}
