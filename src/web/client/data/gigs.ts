import type { GigRecord } from "../../../core/gigs";

export type GigsResult =
  | { ok: true; data: GigRecord[] }
  | { ok: false; error: unknown };

export async function loadGigs(): Promise<GigsResult> {
  try {
    const response = await fetch("/api/gigs", { cache: "no-store" });
    if (!response.ok) throw new Error(`Gigs API returned ${response.status}.`);
    return { ok: true, data: await response.json() as GigRecord[] };
  } catch (error) {
    return { ok: false, error };
  }
}
