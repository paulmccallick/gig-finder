import { useEffect, useState } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

const managedReferencePattern = /^doc_[0-9a-f]+(?:-[0-9a-f]+)*$/i;

export interface DocumentViewerLocation {
  reference: string;
  version: number;
}

interface DocumentViewData extends DocumentViewerLocation {
  storage: "managed";
  displayName: string;
  documentType: string;
  mediaType: "text/markdown" | "text/plain";
  currentVersion: number;
  content: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseDocumentViewerPath(pathname: string): DocumentViewerLocation | null {
  const match = pathname.match(/^\/documents\/([^/]+)\/versions\/([^/]+)$/);
  if (!match) return null;
  let reference: string;
  try {
    reference = decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
  const versionText = match[2] ?? "";
  if (!managedReferencePattern.test(reference) || !/^[1-9]\d*$/.test(versionText)) {
    return null;
  }
  const version = Number(versionText);
  return Number.isSafeInteger(version) ? { reference, version } : null;
}

function parseDocumentViewData(value: unknown, expected: DocumentViewerLocation): DocumentViewData {
  if (!isRecord(value)) throw new Error("The document service returned an invalid response.");
  const mediaType = value.mediaType;
  if (
    value.reference !== expected.reference
    || value.version !== expected.version
    || value.storage !== "managed"
    || typeof value.displayName !== "string"
    || value.displayName.trim().length === 0
    || typeof value.documentType !== "string"
    || (mediaType !== "text/markdown" && mediaType !== "text/plain")
    || typeof value.currentVersion !== "number"
    || !Number.isSafeInteger(value.currentVersion)
    || value.currentVersion <= 0
    || expected.version > value.currentVersion
    || typeof value.content !== "string"
  ) throw new Error("The document service returned an invalid response.");
  return value as unknown as DocumentViewData;
}

export function DocumentViewer({ location }: { location: DocumentViewerLocation | null }) {
  const [document, setDocument] = useState<DocumentViewData | null>(null);
  const [failure, setFailure] = useState<string | null>(
    location ? null : "This document link is invalid.",
  );
  useEffect(() => {
    if (!location) return;
    let active = true;
    setDocument(null);
    setFailure(null);
    const reference = encodeURIComponent(location.reference);
    void fetch(`/api/documents/${reference}/versions/${location.version}`, {
      cache: "no-store",
    }).then(async response => {
      if (response.status === 404) throw new Error("This document version could not be found.");
      if (!response.ok) throw new Error("This document could not be opened.");
      return parseDocumentViewData(await response.json(), location);
    }).then(value => {
      if (active) setDocument(value);
    }).catch(error => {
      if (!active) return;
      setFailure(error instanceof TypeError
        ? "This document requires the GigFinder application server. Reconnect, then reload."
        : error instanceof Error ? error.message : "This document could not be opened.");
    });
    return () => { active = false; };
  }, [location?.reference, location?.version]);

  const download = location
    ? `/api/documents/${encodeURIComponent(location.reference)}/versions/${location.version}/download`
    : null;
  return <main className="document-viewer">
    <header>
      <div>
        <span className="eyebrow">Managed document</span>
        <h1>{document?.displayName ?? "Document"}</h1>
      </div>
      {document && download && <a href={download}>Download</a>}
    </header>
    {!document && !failure && <p className="document-viewer-status">Loading document…</p>}
    {failure && <section className="document-viewer-error" role="alert">
      <h2>Document unavailable</h2>
      <p>{failure}</p>
    </section>}
    {document && <article className="document-viewer-content">
      {document.mediaType === "text/markdown"
        ? <MarkdownRenderer>{document.content}</MarkdownRenderer>
        : <pre>{document.content}</pre>}
    </article>}
  </main>;
}

export function DocumentViewerRoute() {
  return <DocumentViewer location={parseDocumentViewerPath(window.location.pathname)} />;
}
