import type { Person } from "../../../core/src/people";

export type PeopleResult = { ok: true; data: Person[] } | { ok: false; error: unknown };

export async function loadPeople(): Promise<PeopleResult> {
  try {
    const response = await fetch("/api/people", { cache: "no-store" });
    if (!response.ok) throw new Error(`People API returned ${response.status}.`);
    return { ok: true, data: await response.json() as Person[] };
  } catch (error) { return { ok: false, error }; }
}
