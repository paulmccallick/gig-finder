import type { NormalizedPosition, SourceConfiguration } from "../contracts";
import { normalizeDescription } from "../descriptions";

function atPath(value: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>(
      (current, key) =>
        current && typeof current === "object"
          ? (current as Record<string, unknown>)[key]
          : undefined,
      value,
    );
}
export function extractJson(
  source: Extract<SourceConfiguration, { type: "json" }>,
  body: string,
): {
  positions: NormalizedPosition[];
  hasNext: boolean;
  surfaceVerified: boolean;
} {
  const parsed: unknown = JSON.parse(body);
  const records = atPath(parsed, source.recordsPath);
  if (!Array.isArray(records))
    return { positions: [], hasNext: false, surfaceVerified: false };
  const positions = records.flatMap((record): NormalizedPosition[] => {
    if (!record || typeof record !== "object") return [];
    const read = (path: string | undefined) =>
      path ? atPath(record, path) : undefined;
    const title = read(source.fields.title);
    const rawUrl = read(source.fields.url);
    if (typeof title !== "string" || typeof rawUrl !== "string") return [];
    let canonicalUrl: string;
    try {
      canonicalUrl = new URL(rawUrl, source.url).toString();
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
  return { positions, hasNext: Boolean(next), surfaceVerified: true };
}
