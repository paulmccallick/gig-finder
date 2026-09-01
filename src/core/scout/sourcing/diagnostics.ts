import type {
  NormalizedPosition,
  SourceDiagnostic,
  SourceOutcomeStatus,
  ScoutSearchProfile,
} from "./contracts";
import { positionMatchesSearchProfile } from "./matching";
export { positionMatchesSearchProfile } from "./matching";
export function validatePositions<Position extends Pick<NormalizedPosition, "sourceKey" | "externalId" | "canonicalUrl" | "title" | "location" | "locations" | "workArrangement">>(
  positions: Position[],
  surfaceVerified: boolean,
  searchProfile: ScoutSearchProfile = { terms: [], titleVariants: [], locations: [] },
) {
  const accepted: Position[] = [];
  const seen = new Set<string>();
  let duplicateIdentities = 0;
  let invalidTitles = 0;
  let invalidUrls = 0;
  let titleMismatches = 0;
  let locationMismatches = 0;
  const rejectedPositions: Array<{
    position: Position;
    code: string;
    message: string;
  }> = [];
  const filterDecisions = [];
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
    const profileMatch = positionMatchesSearchProfile(position, searchProfile);
    filterDecisions.push({
      identity,
      titleMatched: profileMatch.title,
      locationMatched: profileMatch.location,
      normalizedTitle: profileMatch.normalizedTitle,
      normalizedLocations: profileMatch.normalizedLocations,
      workArrangements: profileMatch.workArrangements,
    });
    if (!profileMatch.title) {
      titleMismatches++;
      rejectedPositions.push({
        position,
        code: "profile_title_mismatch",
        message: "Candidate title did not match the run search profile.",
      });
    }
    if (!profileMatch.location) {
      locationMismatches++;
      rejectedPositions.push({
        position,
        code: "profile_location_mismatch",
        message: "Candidate location did not match the run search profile.",
      });
    }
    if (!profileMatch.title || !profileMatch.location) continue;
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
  if (titleMismatches)
    diagnostics.push({
      code: "profile_title_mismatch",
      category: "validation",
      count: titleMismatches,
      message: "Candidate titles did not match the run search profile.",
    });
  if (locationMismatches)
    diagnostics.push({
      code: "profile_location_mismatch",
      category: "validation",
      count: locationMismatches,
      message: "Candidate locations did not match the run search profile.",
    });
  const rejected = new Set(rejectedPositions.map(({ position }) => position))
    .size;
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
  return { accepted, rejected, rejectedPositions, filterDecisions, diagnostics, status };
}
