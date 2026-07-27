import { registerTelemetry } from "ai";

export async function registerDevelopmentTelemetry(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (
    environment.NODE_ENV !== "development"
    || environment.AI_SDK_DEVTOOLS !== "true"
  ) {
    return false;
  }

  const { DevToolsTelemetry } = await import("@ai-sdk/devtools");
  registerTelemetry(DevToolsTelemetry());
  return true;
}
