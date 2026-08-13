import type { SourceConfiguration } from "./contracts";
export interface PlannedRequest {
  url: string;
  method: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
}
export function planSourceRequest(
  source: SourceConfiguration,
  page = 1,
): PlannedRequest {
  if (source.type === "json" && "template" in source)
    throw new Error("Reusable JSON sources use their template request planner.");
  const url = new URL(source.url);
  url.searchParams.set("page", String(page));
  return {
    url: url.toString(),
    method: source.type === "json" ? source.method : "GET",
    ...(source.type === "json" && source.method === "POST"
      ? { body: JSON.stringify({ ...(source.body ?? {}), page }) }
      : {}),
  };
}
