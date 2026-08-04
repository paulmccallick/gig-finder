import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  hasSavedUpload,
  hasSuccessfulMutation,
  parseStagedUpload,
  savedUploadReferences,
} from "../../../client/agent/AgentPanel";

describe("agent dashboard refresh signal", () => {
  test("recognizes successful task, update, and revert tool output", () => {
    const parts: UIMessage["parts"] = [{
      type: "dynamic-tool",
      toolName: "update_gig",
      toolCallId: "call-1",
      state: "output-available",
      input: {
        id: "gig-1",
        changes: [{ operation: "set", field: "stage", value: "applied" }],
      },
      output: { status: "ok", changeId: "agent-tool:call-1" },
    }];
    expect(hasSuccessfulMutation(parts)).toBe(true);
    expect(hasSuccessfulMutation([{
      type: "dynamic-tool",
      toolName: "create_task",
      toolCallId: "call-task",
      state: "output-available",
      input: {
        title: "Follow up",
        type: "networking_follow_up",
        priority: null,
        dueDate: null,
        relatedEntity: { type: "general", id: null },
        notes: null,
      },
      output: { status: "ok", changeId: "agent-tool:call-task" },
    }])).toBe(true);
    expect(hasSuccessfulMutation([{
      type: "dynamic-tool",
      toolName: "revert_change",
      toolCallId: "call-2",
      state: "output-available",
      input: { changeId: "change-1" },
      output: {
        status: "ok",
        changeId: "change-2",
        revertedChangeId: "change-1",
      },
    }])).toBe(true);
  });

  test("ignores reads and failed mutations", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "dynamic-tool",
        toolName: "get_gig",
        toolCallId: "call-1",
        state: "output-available",
        input: { id: "gig-1" },
        output: { status: "ok", record: { id: "gig-1" } },
      },
      {
        type: "dynamic-tool",
        toolName: "update_gig",
        toolCallId: "call-2",
        state: "output-available",
        input: {
          id: "gig-1",
          changes: [{ operation: "set", field: "stage", value: "applied" }],
        },
        output: { status: "error", error: "validation_failed" },
      },
    ];
    expect(hasSuccessfulMutation(parts)).toBe(false);
  });
});

test("staged attachment clears only after generic document creation saves it", () => {
  const parts: UIMessage["parts"] = [{
    type: "dynamic-tool",
    toolName: "create_document",
    toolCallId: "call-document",
    state: "output-available",
    input: {},
    output: {
      status: "ok",
      changeId: "agent-tool:call-document",
      stagedReference: "staged-document:11111111-1111-4111-8111-111111111111",
    },
  }];
  expect(hasSavedUpload(parts)).toBe(true);
  expect(savedUploadReferences(parts)).toEqual([
    "staged-document:11111111-1111-4111-8111-111111111111",
  ]);
  expect(hasSavedUpload([{
    type: "dynamic-tool",
    toolName: "create_document",
    toolCallId: "call-inline",
    state: "output-available",
    input: {},
    output: { status: "ok", changeId: "agent-tool:call-inline" },
  }])).toBe(false);
});

test("validates staged upload responses before storing UI state", () => {
  const valid = {
    reference: "staged-document:11111111-1111-4111-8111-111111111111",
    filename: "role.md",
    extractionWarnings: [],
    markdownCharacters: 15,
    expiresAt: "2026-07-29T12:15:00.000Z",
  };
  expect(parseStagedUpload(valid)).toEqual(valid);
  expect(() => parseStagedUpload({
    ...valid,
    markdownCharacters: "15",
  })).toThrow("invalid response");
  expect(() => parseStagedUpload({
    ...valid,
    extractionWarnings: [null],
  })).toThrow("invalid response");
});
