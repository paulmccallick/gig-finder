import {
  isAgentModelId,
  type ApplicationSettings,
  type AgentModelId,
} from "../../../core/src/application-settings";

const endpoint = "/api/settings/agent-model";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseApplicationSettings(value: unknown): ApplicationSettings {
  if (!isRecord(value) || !isAgentModelId(value.agentModel)) {
    throw new Error("The settings service returned an invalid agent model.");
  }
  return { agentModel: value.agentModel };
}

async function responseError(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === "string"
    ? body.error
    : `Settings API returned ${response.status}.`;
}

export async function loadApplicationSettings(): Promise<ApplicationSettings> {
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response));
  return parseApplicationSettings(await response.json());
}

export async function saveAgentModel(
  modelId: AgentModelId,
): Promise<ApplicationSettings> {
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return parseApplicationSettings(await response.json());
}
