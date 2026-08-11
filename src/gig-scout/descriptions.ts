const maxDescriptionCharacters = 200_000;
export function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return normalized ? normalized.slice(0, maxDescriptionCharacters) : null;
}
