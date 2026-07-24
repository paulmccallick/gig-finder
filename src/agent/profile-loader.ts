import { readFileSync } from "node:fs";
import { jobSearchProfileSchema, type JobSearchProfile } from "./types";

export function loadJobSearchProfile(filename: string): JobSearchProfile {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read job-search profile: ${filename}`, { cause: error });
  }

  const result = jobSearchProfileSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid job-search profile ${filename}: ${result.error.issues
        .map(issue => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}
