export type PwaCacheStrategy = "navigation-network-first" | "static-cache-first" | "network-only";

export function pwaCacheStrategy(input: {
  method: string;
  mode: string;
  requestUrl: string;
  applicationOrigin: string;
}): PwaCacheStrategy {
  if (input.method === "GET" && input.mode === "navigate") return "navigation-network-first";
  const url = new URL(input.requestUrl, input.applicationOrigin);
  if (
    input.method === "GET"
    && url.origin === input.applicationOrigin
    && url.pathname.startsWith("/assets/")
  ) return "static-cache-first";
  return "network-only";
}
