import type { Job } from "../../../core/src/jobs";

export type JobsResult =
  | { ok: true; data: Job[] }
  | { ok: false; error: unknown };

export async function loadJobs(): Promise<JobsResult> {
  try {
    const response = await fetch("/api/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error(`Jobs API returned ${response.status}.`);
    return { ok: true, data: await response.json() as Job[] };
  } catch (error) {
    return { ok: false, error };
  }
}
