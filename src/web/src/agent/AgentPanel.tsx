import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

const starterPrompts = [
  "What kinds of roles should I prioritize?",
  "How should I position my background?",
  "Which role categories are poor fits?",
];

function messageText(parts: Array<{ type: string; text?: string }>) {
  return parts.filter(part => part.type === "text").map(part => part.text ?? "").join("");
}

export function AgentPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/agent/messages" }), []);
  const {
    messages,
    sendMessage,
    stop,
    status,
    error,
    clearError,
  } = useChat({ transport, throttle: 30 });
  const active = status === "submitted" || status === "streaming";

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
    if (!value || active) return;
    clearError();
    setInput("");
    await sendMessage({ text: value });
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
        <p>I understand your target roles, strengths, constraints, and search strategy. Live applications, contacts, tasks, and documents are not connected yet.</p>
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

      {error && (
        <div className="agent-error" role="alert">
          <span>CONNECTION FAULT</span>
          <p>{error.message || "The JobSearchAgent could not complete that response."}</p>
          <button type="button" onClick={clearError}>Dismiss</button>
        </div>
      )}

      <form className="agent-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
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
          disabled={!open}
        />
        <div className="agent-composer-footer">
          <span>{active ? "STREAM ACTIVE" : "NO LIVE DATA ACCESS"}</span>
          {active
            ? <button className="agent-stop" type="button" onClick={stop}>Stop <i /></button>
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
