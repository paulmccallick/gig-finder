import { expect, test } from "bun:test";
import { parseApplicationSettings } from "./settings";

test("validates the persisted agent model response", () => {
  expect(parseApplicationSettings({ agentModel: "gpt-5.6-terra" }))
    .toEqual({ agentModel: "gpt-5.6-terra" });
  expect(() => parseApplicationSettings({ agentModel: "gpt-unsupported" }))
    .toThrow("invalid agent model");
  expect(() => parseApplicationSettings(null))
    .toThrow("invalid agent model");
});
