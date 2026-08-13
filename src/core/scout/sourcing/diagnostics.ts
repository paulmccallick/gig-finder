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
  let duplicateIdentities = 0;
  let invalidTitles = 0;
  let invalidUrls = 0;
  const rejectedPositions: Array<{
    position: NormalizedPosition;
    code: string;
    message: string;
  }> = [];
  for (const position of positions) {
    const identity = `${position.sourceKey}\0${position.externalId ?? position.canonicalUrl}`;
    if (seen.has(identity)) {
      duplicateIdentities++;
      rejectedPositions.push({
        position,
        code: "duplicate_identity",
        message: "Candidates repeated an identity already evaluated.",
      });
      continue;
    }
    if (!position.title.trim()) {
      invalidTitles++;
      rejectedPositions.push({
        position,
        code: "missing_title",
        message: "Candidates did not provide a credible non-empty title.",
      });
      continue;
    }
    if (!position.canonicalUrl.startsWith("https://")) {
      invalidUrls++;
      rejectedPositions.push({
        position,
        code: "invalid_official_url",
        message: "Candidates did not provide an HTTPS official detail URL.",
      });
      continue;
    }
    seen.add(identity);
    accepted.push(position);
  }
  const diagnostics: SourceDiagnostic[] = [];
  if (duplicateIdentities)
    diagnostics.push({
      code: "duplicate_identity",
      category: "validation",
      count: duplicateIdentities,
      message: "Candidates repeated an identity already evaluated.",
    });
  if (invalidTitles)
    diagnostics.push({
      code: "missing_title",
      category: "validation",
      count: invalidTitles,
      message: "Candidates did not provide a credible non-empty title.",
    });
  if (invalidUrls)
    diagnostics.push({
      code: "invalid_official_url",
      category: "validation",
      count: invalidUrls,
      message: "Candidates did not provide an HTTPS official detail URL.",
    });
  const rejected = duplicateIdentities + invalidTitles + invalidUrls;
  let status: SourceOutcomeStatus = accepted.length
    ? invalidTitles + invalidUrls
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
  return { accepted, rejected, rejectedPositions, diagnostics, status };
}
