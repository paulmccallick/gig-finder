import type { NormalizedPosition } from "../../contracts";
import { normalizeDescription } from "../../descriptions";
import { assignedJson, atPath } from "../../extractors/json";
import type { ReusableJsonTemplateSource } from "./types";
import type { SourcePage } from "../types";
import type { ReusableJsonDefinition } from "./definitions";
export type Json = Record<string, unknown>;
export const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const arrayField = (value: Json, key: string) =>
  Object.hasOwn(value, key) && Array.isArray(value[key])
    ? (value[key] as unknown[])
    : null;
export const text = (value: unknown) =>
  typeof value === "string" ? value : "";
export const scalar = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
export const absolute = (value: string, base: string) => {
  if (!value.trim()) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
};
export function normalize(
  source: ReusableJsonTemplateSource,
  value: {
    id?: unknown;
    title?: unknown;
    url?: unknown;
    location?: unknown;
    description?: unknown;
    descriptionUrl?: unknown;
  },
): NormalizedPosition | null {
  const title = text(value.title).trim(),
    url = absolute(text(value.url), source.url);
  if (!title || !url) return null;
  const description = normalizeDescription(value.description);
  const descriptionSourceContent=typeof value.description==="string"?value.description:null;
  const configuredDescriptionUrl = absolute(
    text(value.descriptionUrl),
    source.url,
  );
  const descriptionUrl = configuredDescriptionUrl || (description ? null : url);
  return {
    sourceKey: source.key,
    externalId: scalar(value.id) || null,
    canonicalUrl: url,
    title,
    location: text(value.location).trim() || null,
    description,
    descriptionSourceContent,
    provenance: {
      sourceKey: source.key,
      sourceUrl: source.url,
      description: description ? "listing" : "none",
      descriptionUrl,
    },
  };
}
export function page(
  positions: NormalizedPosition[],
  records: unknown[],
  surfaceVerified: boolean,
  total: number | null,
  pageNumber: number,
  pageSize: number,
  exhaustionMode: "reported-total" | "single-response" = "reported-total",
): SourcePage {
  return {
    positions,
    recordsReceived: records.length,
    surfaceVerified,
    sourceReportedTotal: total,
    hasNext:
      exhaustionMode === "reported-total" &&
      total !== null &&
      records.length > 0 &&
      (pageNumber - 1) * pageSize + records.length < total,
  };
}

function transformText(value: string, transform: string) {
  if (transform === "slug")
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  if (transform === "strip-job-prefix")
    return value.replace(/^am9icG9zdDq/, "");
  if (transform === "url-encode") return encodeURIComponent(value);
  return value;
}

function sourceToken(source: ReusableJsonTemplateSource, key: string) {
  const configured = new URL(source.url);
  if (key === "origin") return configured.origin;
  if (key.startsWith("path.")) {
    const index = Number(key.slice("path.".length));
    return configured.pathname.split("/").filter(Boolean)[index] ?? "";
  }
  if (key.startsWith("pathAfter.")) {
    const parts = configured.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf(key.slice("pathAfter.".length));
    return marker >= 0 ? parts[marker + 1] ?? "" : "";
  }
  if (key.startsWith("query."))
    return configured.searchParams.get(key.slice("query.".length)) ?? "";
  if (key.startsWith("hashQuery."))
    return (
      new URLSearchParams(configured.hash.slice(1)).get(
        key.slice("hashQuery.".length),
      ) ?? ""
    );
  return "";
}

function recordToken(record: unknown, key: string) {
  const [path = "", transform] = key.split(":");
  const value = scalar(atPath(record, path));
  return transform ? transformText(value, transform) : value;
}

function renderFieldTemplate(
  template: string,
  selected: unknown,
  source: ReusableJsonTemplateSource,
  record: unknown,
) {
  return template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const [key = "", fallback = ""] = token.split("|");
    let value = "";
    if (key === "value") value = scalar(selected);
    else if (key.startsWith("source."))
      value = sourceToken(source, key.slice("source.".length));
    else if (key.startsWith("variable."))
      value = scalar(source.variables[key.slice("variable.".length) as keyof typeof source.variables]);
    else if (key.startsWith("override."))
      value = scalar(source.overrides[key.slice("override.".length) as keyof typeof source.overrides]);
    else if (key.startsWith("record."))
      value = recordToken(record, key.slice("record.".length));
    if (value) return value;
    if (fallback.startsWith("source."))
      return sourceToken(source, fallback.slice("source.".length));
    if (fallback.startsWith("record."))
      return recordToken(record, fallback.slice("record.".length));
    return fallback;
  });
}

function fieldValue(
  record: unknown,
  field:
    | {
        paths: string[];
        separator?: string;
        template?: string;
        fallbackPaths?: string[];
        fallbackTemplate?: string;
        transforms?: string[];
        fallbackTransforms?: string[];
        find?: {
          path: string;
          wherePath: string;
          equals: string;
          valuePath: string;
        };
      }
    | undefined,
  source: ReusableJsonTemplateSource,
  payload: unknown,
  index: number,
) {
  if (!field) return undefined;
  if (field.find) {
    const candidates = atPath(record, field.find.path);
    const found = array(candidates).find(
      (candidate) =>
        scalar(atPath(candidate, field.find!.wherePath)) === field.find!.equals,
    );
    if (found) return atPath(found, field.find.valuePath);
  }
  const valuesAtPaths = (paths: string[]) => paths.flatMap((path) => {
    const resolvedPath = path.replaceAll("$index", String(index));
    const selected = resolvedPath.startsWith("$payload.")
      ? atPath(payload, resolvedPath.slice("$payload.".length))
      : atPath(record, resolvedPath);
    return Array.isArray(selected) ? selected : [selected];
  });
  let present = valuesAtPaths(field.paths).filter(
    (value) => value !== undefined && value !== null && value !== "",
  );
  const usingFallback = present.length === 0 && Boolean(field.fallbackPaths?.length);
  if (usingFallback)
    present = valuesAtPaths(field.fallbackPaths ?? []).filter(
      (value) => value !== undefined && value !== null && value !== "",
    );
  let selected = field.separator
    ? present.map(scalar).filter(Boolean).join(field.separator)
    : present[0];
  const transforms = usingFallback
    ? field.fallbackTransforms ?? []
    : field.transforms ?? [];
  for (const transform of transforms)
    selected = transformText(scalar(selected), transform);
  const template = usingFallback ? field.fallbackTemplate : field.template;
  if (!template) return selected;
  return renderFieldTemplate(template, selected, source, record);
}

export function decodeReusableJson(
  source: ReusableJsonTemplateSource,
  body: string,
  pageNumber: number,
  definition: ReusableJsonDefinition,
): SourcePage {
  let payload: unknown;
  if (definition.payload?.assignment) {
    try {
      payload = assignedJson(body, definition.payload.assignment);
    } catch {
      payload = {};
    }
  } else payload = JSON.parse(body);
  const selectedRecords = definition.recordsPaths
    .filter((path) => {
      const root = path.split(".*", 1)[0]!;
      return atPath(payload, root) !== undefined;
    })
    .map((path) => atPath(payload, path))
    .find(Array.isArray);
  const records = selectedRecords ?? [];
  const positions = records.flatMap((value, index) => {
    const record =
      definition.record?.unwrapPaths
        .map((path) => atPath(value, path))
        .find((candidate) => Object.keys(object(candidate)).length > 0) ?? value;
    if (!record) return [];
    const result = normalize(source, {
      id: fieldValue(record, definition.fields.id, source, payload, index),
      title: fieldValue(record, definition.fields.title, source, payload, index),
      url: fieldValue(record, definition.fields.url, source, payload, index),
      location: fieldValue(record, definition.fields.location, source, payload, index),
      description: fieldValue(record, definition.fields.description, source, payload, index),
      descriptionUrl: fieldValue(
        record,
        definition.fields.descriptionUrl,
        source,
        payload,
        index,
      ),
    });
    return result ? [result] : [];
  });
  const totalValue = definition.totalPaths
    .map((path) => atPath(payload, path))
    .find((value) => value !== undefined && value !== null);
  const total = totalValue === undefined ? null : Number(totalValue);
  const decoded = page(
    positions,
    records,
    selectedRecords !== null && selectedRecords !== undefined,
    total !== null && Number.isFinite(total) ? total : null,
    pageNumber,
    definition.pageSize,
    definition.exhaustion.mode,
  );
  return decoded;
}
