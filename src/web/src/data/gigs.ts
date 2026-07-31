import type { Gig } from "../../../core/src/gigs";

export type GigsResult =
  | { ok: true; data: Gig[] }
  | { ok: false; error: unknown };

export async function loadGigs(): Promise<GigsResult> {
  try {
    const response = await fetch("/api/gigs", { cache: "no-store" });
    if (!response.ok) throw new Error(`Gigs API returned ${response.status}.`);
    return { ok: true, data: await response.json() as Gig[] };
  } catch (error) {
    return { ok: false, error };
  }
}
