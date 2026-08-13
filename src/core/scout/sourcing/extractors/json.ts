import type { NormalizedPosition, SourceConfiguration } from "../contracts";
import { normalizeDescription } from "../descriptions";

export function atPath(value: unknown, path: string): unknown {
  if (path === "$") return value;
  const [key, ...remaining] = path.split(".").filter(Boolean);
  if (!key) return value;
  if (key === "*")
    return (Array.isArray(value) ? value : Object.values(object(value))).flatMap(
      (entry) => {
        const selected = atPath(entry, remaining.join("."));
        return Array.isArray(selected) ? selected : [selected];
      },
    );
  if (Array.isArray(value) && /^\d+$/.test(key))
    return atPath(value[Number(key)], remaining.join("."));
  return atPath(object(value)[key], remaining.join("."));
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function assignedJson(script: string, assignment: string) {
  const marker = script.indexOf(assignment);
  if (marker < 0) throw new Error("json_script_assignment_missing");
  const start = script.indexOf("{", marker + assignment.length);
  if (start < 0) throw new Error("json_script_assignment_invalid");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < script.length; index++) {
    const character = script[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0)
      return JSON.parse(script.slice(start, index + 1));
  }
  throw new Error("json_script_assignment_unterminated");
}
export function extractJson(
  source: Extract<SourceConfiguration, { recordsPath: string }>,
  body: string,
): {
  positions: NormalizedPosition[];
  hasNext: boolean;
  surfaceVerified: boolean;
  sourceReportedTotal: number | null;
  recordsReceived: number;
  nextPageUrl?: string | null;
} {
  const parsed: unknown = JSON.parse(body);
  const records = atPath(parsed, source.recordsPath);
  if (!Array.isArray(records))
    return {
      positions: [],
      hasNext: false,
      surfaceVerified: false,
      sourceReportedTotal: null,
      recordsReceived: 0,
    };
  const positions = records.flatMap((record): NormalizedPosition[] => {
    if (!record || typeof record !== "object") return [];
    const read = (path: string | undefined) =>
      path ? atPath(record, path) : undefined;
    const title = read(source.fields.title);
    const rawUrl = read(source.fields.url);
    if (typeof title !== "string" || typeof rawUrl !== "string") return [];
    let canonicalUrl: string;
    try {
      canonicalUrl = new URL(
        `${source.fields.urlPrefix ?? ""}${rawUrl}`,
        source.url,
      ).toString();
    } catch {
      return [];
    }
    const id = read(source.fields.id);
    const location = read(source.fields.location);
    const description = normalizeDescription(read(source.fields.description));
    return [
      {
        sourceKey: source.key,
        externalId:
          typeof id === "string" || typeof id === "number" ? String(id) : null,
        canonicalUrl,
        title: title.trim(),
        location: typeof location === "string" ? location.trim() || null : null,
        description,
        provenance: {
          sourceKey: source.key,
          sourceUrl: source.url,
          description: description ? "listing" : "none",
          descriptionUrl: description ? null : canonicalUrl,
        },
      },
    ];
  });
  const next = source.nextPagePath
    ? atPath(parsed, source.nextPagePath)
    : undefined;
  return {
    positions,
    hasNext: Boolean(next),
    surfaceVerified: true,
    sourceReportedTotal: null,
    recordsReceived: records.length,
    nextPageUrl:
      typeof next === "string" && next.trim()
        ? new URL(next, source.url).toString()
        : null,
  };
}

export async function extractJsonScriptEnvelope(
  source: Extract<SourceConfiguration, { recordsPath: string }>,
  body: string,
) {
  if (!source.scriptEnvelope) return extractJson(source, body);
  let script = "";
  const rewriter = new HTMLRewriter().on(source.scriptEnvelope.selector, {
    text(text) {
      script += text.text;
    },
  });
  await rewriter.transform(new Response(body)).text();
  if (!script.trim())
    return {
      positions: [],
      hasNext: false,
      surfaceVerified: false,
      sourceReportedTotal: null,
      recordsReceived: 0,
    };
  const envelope = source.scriptEnvelope.assignment
    ? assignedJson(script, source.scriptEnvelope.assignment)
    : JSON.parse(script);
  const selected = source.scriptEnvelope.valuePath
    ? atPath(envelope, source.scriptEnvelope.valuePath)
    : envelope;
  return extractJson(source, JSON.stringify(selected));
}
