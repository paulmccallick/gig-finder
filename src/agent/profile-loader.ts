import { readFileSync } from "node:fs";
import { candidateProfileSchema, type CandidateProfile } from "./types";

export function loadCandidateProfile(filename: string): CandidateProfile {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read gig-finder profile: ${filename}`, { cause: error });
  }

  const result = candidateProfileSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid gig-finder profile ${filename}: ${result.error.issues
        .map(issue => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
