import { describe, expect, test } from "bun:test";
import {
  agentModelCatalog,
  ApplicationSettingsService,
  defaultAgentModelId,
  parseAgentModelId,
} from "../application-settings";

class MemorySettings {
  readonly values = new Map<string, string>();
  get(key: string) { return this.values.get(key) ?? null; }
  set(key: string, value: string) { this.values.set(key, value); }
}

describe("application settings", () => {
  test("uses Sol by default and supports a configured startup default", () => {
    expect(new ApplicationSettingsService(new MemorySettings()).get())
      .toEqual({ agentModel: defaultAgentModelId });
    expect(new ApplicationSettingsService(
      new MemorySettings(),
      "gpt-5.6-terra",
    ).get()).toEqual({ agentModel: "gpt-5.6-terra" });
  });

  test("persists a selected model over the startup default", () => {
    const repository = new MemorySettings();
    const settings = new ApplicationSettingsService(
      repository,
      "gpt-5.6-terra",
    );
    expect(settings.setAgentModel("gpt-5.6-luna"))
      .toEqual({ agentModel: "gpt-5.6-luna" });
    expect(new ApplicationSettingsService(
      repository,
      "gpt-5.6-sol",
    ).get()).toEqual({ agentModel: "gpt-5.6-luna" });
  });

  test("rejects values outside the shared model catalog", () => {
    expect(agentModelCatalog.map(model => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
    ]);
    expect(() => parseAgentModelId("gpt-unsupported"))
      .toThrow("Agent model must be one of");
  });
});
