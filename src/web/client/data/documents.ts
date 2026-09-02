export interface ManagedDocumentLocation {
  reference: string;
  version: number;
}

export interface ManagedDocumentViewData extends ManagedDocumentLocation {
  storage: "managed";
  displayName: string;
  documentType: string;
  mediaType: "text/markdown" | "text/plain";
  currentVersion: number;
  content: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseManagedDocumentViewData(
  value: unknown,
  expected: ManagedDocumentLocation,
): ManagedDocumentViewData {
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
  return value as unknown as ManagedDocumentViewData;
}

export async function loadManagedDocumentVersion(
  location: ManagedDocumentLocation,
): Promise<ManagedDocumentViewData> {
  const response = await fetch(
    `/api/documents/${encodeURIComponent(location.reference)}/versions/${location.version}`,
    { cache: "no-store" },
  );
  if (response.status === 404) throw new Error("This document version could not be found.");
  if (!response.ok) throw new Error("This document could not be opened.");
  return parseManagedDocumentViewData(await response.json(), location);
}
