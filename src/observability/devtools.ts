import { registerTelemetry } from "ai";

export async function registerAiSdkDevTools(
  enabled: boolean,
) {
  if (!enabled) return false;

  const { DevToolsTelemetry } = await import("@ai-sdk/devtools");
  registerTelemetry(DevToolsTelemetry());
  return true;
}
