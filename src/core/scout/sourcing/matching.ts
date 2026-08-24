import type {
  NormalizedLocation,
  NormalizedPosition,
  ScoutSearchProfile,
  WorkArrangement,
} from "./contracts";

export const normalizeMatchText = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

const tokens = (value: string) =>
  normalizeMatchText(value).match(/[\p{L}\p{N}]+/gu) ?? [];

const containsTokenSequence = (value: string, expected: string) => {
  const haystack = tokens(value);
  const needle = tokens(expected);
  if (!needle.length) return false;
  return haystack.some((_, index) =>
    needle.every((token, offset) => haystack[index + offset] === token),
  );
};

export function normalizeWorkArrangement(value: string): WorkArrangement | null {
  const normalized = normalizeMatchText(value).replace(/[–—]/g, "-");
  if (/\b(remote|work(?:ing)? (?:at|from) home|home[- ]based)\b/u.test(normalized))
    return "remote";
  if (/\bhybrid\b/u.test(normalized)) return "hybrid";
  if (/\b(on[- ]?site|in[- ]person)\b/u.test(normalized)) return "on-site";
  return null;
}

export function normalizeLocations(values: unknown[]): NormalizedLocation[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (typeof value !== "string") return [];
    const label = value.replace(/\s+/g, " ").trim();
    const key = normalizeMatchText(label);
    if (!label || aggregateLocation(label) || seen.has(key)) return [];
    seen.add(key);
    return [{ label, workArrangement: normalizeWorkArrangement(label) }];
  });
}

const aggregateLocation = (value: string | null) =>
  Boolean(value && /^\d+\s+locations?(?:\s*[-–—].*)?$/iu.test(value.trim()));

export function positionMatchesSearchProfile(
  position: Pick<NormalizedPosition, "title" | "location" | "locations" | "workArrangement">,
  profile: ScoutSearchProfile,
) {
  const applicableVariants = (profile.titleVariants ?? []).flatMap(({ term, variants }) =>
    profile.terms.some((configured) => normalizeMatchText(configured) === normalizeMatchText(term))
      ? variants
      : [],
  );
  const titleTerms = [...profile.terms, ...applicableVariants];
  const normalizedLocations = (position.locations ?? []).map(({ label }) => normalizeMatchText(label));
  const workArrangements = new Set(
    [position.workArrangement ?? null, ...(position.locations ?? []).map(({ workArrangement }) => workArrangement)]
      .filter((value): value is WorkArrangement => value !== null),
  );
  const locationMatched = profile.locations.length
    ? profile.locations.some((configured) => {
        const intent = normalizeWorkArrangement(configured);
        if (intent && workArrangements.has(intent)) return true;
        return normalizedLocations.some((location) => containsTokenSequence(location, configured));
      }) || (normalizedLocations.length === 0 && aggregateLocation(position.location))
    : true;
  return {
    title: titleTerms.length
      ? titleTerms.some((term) => containsTokenSequence(position.title, term))
      : true,
    location: locationMatched,
    normalizedTitle: normalizeMatchText(position.title),
    normalizedLocations,
    workArrangements: [...workArrangements],
  };
}
