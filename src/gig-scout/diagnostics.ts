import type {
  NormalizedPosition,
  SourceDiagnostic,
  SourceOutcomeStatus,
} from "./contracts";
export function validatePositions(
  positions: NormalizedPosition[],
  surfaceVerified: boolean,
) {
  const accepted: NormalizedPosition[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const position of positions) {
    const identity = `${position.sourceKey}\0${position.externalId ?? position.canonicalUrl}`;
    if (
      !position.title.trim() ||
      !position.canonicalUrl.startsWith("https://") ||
      seen.has(identity)
    ) {
      rejected++;
      continue;
    }
    seen.add(identity);
    accepted.push(position);
  }
  const diagnostics: SourceDiagnostic[] = rejected
    ? [
        {
          code: "candidates_rejected",
          category: "validation",
          count: rejected,
          message: "Candidates failed generic identity or URL validation.",
        },
      ]
    : [];
  let status: SourceOutcomeStatus = accepted.length
    ? rejected
      ? "partial"
      : "succeeded_with_results"
    : surfaceVerified
      ? "succeeded_empty_verified"
      : "suspicious_empty";
  if (!surfaceVerified && accepted.length) {
    status = "partial";
    diagnostics.push({
      code: "listing_surface_unverified",
      category: "validation",
      count: 1,
      message:
        "Results were extracted but the configured listing surface was not verified.",
    });
  }
  return { accepted, rejected, diagnostics, status };
}
