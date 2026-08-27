import { useEffect, useState } from "react";
import {
  DocumentViewShell,
  parseScoutDescriptionViewerPath,
} from "./DocumentViewShell";

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

interface ScoutDescriptionViewData {
  id: string;
  title: string;
  company: string;
  descriptionMarkdown: string | null;
  descriptionSourceUrl: string | null;
  descriptionRetrievedAt: string | null;
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

function parseScoutDescriptionViewData(value: unknown, positionId: string): ScoutDescriptionViewData {
  if (!isRecord(value)) throw new Error("The Scout position service returned an invalid response.");
  if (
    value.id !== positionId
    || typeof value.title !== "string"
    || value.title.trim().length === 0
    || typeof value.company !== "string"
    || value.company.trim().length === 0
    || (typeof value.descriptionMarkdown !== "string" && value.descriptionMarkdown !== null)
    || (typeof value.descriptionSourceUrl !== "string" && value.descriptionSourceUrl !== null)
    || (typeof value.descriptionRetrievedAt !== "string" && value.descriptionRetrievedAt !== null)
  ) throw new Error("The Scout position service returned an invalid response.");
  return value as unknown as ScoutDescriptionViewData;
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
      if (active) setFailure(error instanceof Error ? error.message : "This document could not be opened.");
    });
    return () => { active = false; };
  }, [location?.reference, location?.version]);

  const downloadHref = location
    ? `/api/documents/${encodeURIComponent(location.reference)}/versions/${location.version}/download`
    : undefined;
  return <DocumentViewShell
    eyebrow="Managed document"
    title={document?.displayName ?? "Document"}
    content={document?.content ?? null}
    mediaType={document?.mediaType ?? "text/markdown"}
    loading={location !== null && document === null && failure === null}
    failure={failure}
    downloadHref={document ? downloadHref : undefined}
    backFallbackHref="/"
  />;
}

export function ScoutDescriptionViewer({ positionId }: { positionId: string | null }) {
  const [position, setPosition] = useState<ScoutDescriptionViewData | null>(null);
  const [failure, setFailure] = useState<string | null>(
    positionId ? null : "This Scout description link is invalid.",
  );
  useEffect(() => {
    if (!positionId) return;
    let active = true;
    setPosition(null);
    setFailure(null);
    void fetch(`/api/gig-scout/positions/${encodeURIComponent(positionId)}`, {
      cache: "no-store",
    }).then(async response => {
      if (response.status === 404) throw new Error("This Scout position could not be found.");
      if (!response.ok) throw new Error("This Scout description could not be opened.");
      return parseScoutDescriptionViewData(await response.json(), positionId);
    }).then(value => {
      if (active) setPosition(value);
    }).catch(error => {
      if (active) setFailure(error instanceof Error ? error.message : "This Scout description could not be opened.");
    });
    return () => { active = false; };
  }, [positionId]);

  return <DocumentViewShell
    eyebrow="Scout position description"
    title={position?.title ?? "Position description"}
    content={position?.descriptionMarkdown ?? null}
    mediaType="text/markdown"
    loading={positionId !== null && position === null && failure === null}
    failure={failure}
    backFallbackHref="/?workspace=scout"
  />;
}

export function DocumentViewerRoute() {
  const pathname = window.location.pathname;
  if (pathname.startsWith("/documents/")) {
    return <DocumentViewer location={parseDocumentViewerPath(pathname)} />;
  }
  return <ScoutDescriptionViewer positionId={parseScoutDescriptionViewerPath(pathname)?.positionId ?? null} />;
}

export { parseScoutDescriptionViewerPath } from "./DocumentViewShell";
