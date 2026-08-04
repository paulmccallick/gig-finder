import { DomainValidationError } from "./errors";
import type { ApplicationSettingsRepository } from "./ports";

export const agentModelCatalog = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
] as const;

export type AgentModelId = typeof agentModelCatalog[number]["id"];

export const defaultAgentModelId: AgentModelId = "gpt-5.6-sol";

export interface ApplicationSettings {
  agentModel: AgentModelId;
}

const agentModelSettingKey = "agent_model";

export function isAgentModelId(value: unknown): value is AgentModelId {
  return typeof value === "string"
    && agentModelCatalog.some(model => model.id === value);
}

export function parseAgentModelId(value: unknown): AgentModelId {
  if (isAgentModelId(value)) return value;
  throw new DomainValidationError(
    `Agent model must be one of: ${agentModelCatalog.map(model => model.id).join(", ")}.`,
  );
}

export class ApplicationSettingsService {
  constructor(
    private readonly repository: ApplicationSettingsRepository,
    private readonly defaultAgentModel: AgentModelId = defaultAgentModelId,
  ) {}

  get(): ApplicationSettings {
    const stored = this.repository.get(agentModelSettingKey);
    return {
      agentModel: stored === null
        ? this.defaultAgentModel
        : parseAgentModelId(stored),
    };
  }

  setAgentModel(agentModel: AgentModelId): ApplicationSettings {
    this.repository.set(agentModelSettingKey, agentModel);
    return { agentModel };
  }
}
