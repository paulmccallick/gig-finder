import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { hasSuccessfulMutation } from "./AgentPanel";

describe("agent dashboard refresh signal", () => {
  test("recognizes successful mutation tool output", () => {
    const parts: UIMessage["parts"] = [{
      type: "dynamic-tool",
      toolName: "update_job",
      toolCallId: "call-1",
      state: "output-available",
      input: { id: "job-1", patch: { stage: "applied" } },
      output: { status: "ok", changeId: "agent-tool:call-1" },
    }];
    expect(hasSuccessfulMutation(parts)).toBe(true);
  });

  test("ignores reads and failed mutations", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "dynamic-tool",
        toolName: "get_job",
        toolCallId: "call-1",
        state: "output-available",
        input: { id: "job-1" },
        output: { status: "ok", record: { id: "job-1" } },
      },
      {
        type: "dynamic-tool",
        toolName: "update_job",
        toolCallId: "call-2",
        state: "output-available",
        input: { id: "job-1", patch: { stage: "applied" } },
        output: { status: "error", error: "validation_failed" },
      },
    ];
    expect(hasSuccessfulMutation(parts)).toBe(false);
  });
});
