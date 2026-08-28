import { MarkdownRenderer } from "./MarkdownRenderer";
import type { JSX } from "react";

const scoutPositionIdPattern = /^spos_[0-9a-f]+$/;

export interface DocumentNavigation {
  hasOpenOpener: boolean;
  historyLength: number;
  close(): void;
  back(): void;
  assign(href: string): void;
}

export interface DocumentViewShellProps {
  eyebrow: string;
  title: string;
  content: string | null;
  mediaType: "text/markdown" | "text/plain";
  loading: boolean;
  failure: string | null;
  downloadHref?: string;
  backFallbackHref: string;
}

export function parseScoutDescriptionViewerPath(pathname: string): { positionId: string } | null {
  const match = pathname.match(/^\/gig-scout\/positions\/([^/]+)\/description$/);
  if (!match) return null;
  let positionId: string;
  try {
    positionId = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  return scoutPositionIdPattern.test(positionId) ? { positionId } : null;
}

export function leaveDocumentView(
  navigation: DocumentNavigation,
  fallbackHref: string,
): "closed" | "history" | "fallback" {
  if (navigation.hasOpenOpener) {
    navigation.close();
    return "closed";
  }
  if (navigation.historyLength > 1) {
    navigation.back();
    return "history";
  }
  navigation.assign(fallbackHref);
  return "fallback";
}

export function DocumentViewShell({
  eyebrow,
  title,
  content,
  mediaType,
  loading,
  failure,
  downloadHref,
  backFallbackHref,
}: DocumentViewShellProps): JSX.Element {
  const leave = () => {
    leaveDocumentView({
      hasOpenOpener: window.opener !== null && !window.opener.closed,
      historyLength: window.history.length,
      close: () => window.close(),
      back: () => window.history.back(),
      assign: href => window.location.assign(href),
    }, backFallbackHref);
  };
  const unavailable = !loading && !failure && content === null
    ? "This document does not have available content."
    : null;
  const error = failure ?? unavailable;

  return <main className="document-viewer">
    <header>
      <button className="document-viewer-back icon-button" type="button" onClick={leave}>Back</button>
      <div className="document-viewer-title">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {downloadHref && <a href={downloadHref}>Download</a>}
    </header>
    {loading && <p className="document-viewer-status">Loading document…</p>}
    {error && <section className="document-viewer-error" role="alert">
      <h2>Document unavailable</h2>
      <p>{error}</p>
    </section>}
    {!loading && !error && content !== null && <article className="document-viewer-content">
      {mediaType === "text/markdown"
        ? <MarkdownRenderer>{content}</MarkdownRenderer>
        : <pre>{content}</pre>}
    </article>}
  </main>;
}
