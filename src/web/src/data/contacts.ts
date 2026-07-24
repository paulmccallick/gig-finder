import type { NetworkContact } from "../../../core/src/network";

export type ContactsResult = { ok: true; data: NetworkContact[] } | { ok: false; error: unknown };

export async function loadContacts(): Promise<ContactsResult> {
  try {
    const response = await fetch("/api/network", { cache: "no-store" });
    if (!response.ok) throw new Error(`Networking API returned ${response.status}.`);
    return { ok: true, data: await response.json() as NetworkContact[] };
  } catch (error) { return { ok: false, error }; }
}
