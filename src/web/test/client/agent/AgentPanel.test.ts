import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import {
  hasSavedUpload,
  hasSuccessfulMutation,
  parseStagedUpload,
  savedUploadReferences,
  userMessageText,
} from "../../../client/agent/AgentPanel";
import {
  agentToolLabels,
  currentAgentActivity,
  toolActivity,
} from "../../../client/agent/agent-activity";

describe("agent activity presentation", () => {
  test("maps every current tool to a friendly label", () => {
    expect(Object.keys(agentToolLabels).sort()).toEqual([
      "create_document", "create_gig", "create_gig_person_relationship",
      "create_meeting", "create_person", "create_task", "get_document",
      "get_gig", "get_gig_person_relationship", "get_meeting", "get_person",
      "get_task", "list_document_versions", "list_documents", "list_gig_person_relationships",
      "list_gigs", "list_meetings", "list_people", "list_tasks", "revert_change",
      "search_gigs_and_people", "update_document", "update_gig", "update_meeting",
      "update_person", "update_task",
    ]);
    for (const label of Object.values(agentToolLabels)) {
      expect(label).not.toMatch(/_|\b(?:id|database|payload)\b/i);
    }
  });

  test("derives ordered reasoning, tool, answer, and terminal tool states without payloads", () => {
    const reasoning = [{ type: "reasoning" as const, text: "Checking the relevant role." }];
    expect(currentAgentActivity("streaming", reasoning)).toEqual({ label: "Thinking", tone: "active" });

    const tool = {
      type: "dynamic-tool" as const,
      toolName: "list_gigs",
      toolCallId: "secret-call-id",
      state: "input-available" as const,
      input: { company: "secret-payload" },
    };
    expect(currentAgentActivity("streaming", [...reasoning, tool])).toEqual({
      label: "Searching gigs", tone: "active",
    });
    expect(JSON.stringify(toolActivity(tool))).not.toContain("secret");
    expect(currentAgentActivity("streaming", [...reasoning, tool, {
      type: "text", text: "Here is the result.",
    }])).toEqual({ label: "Writing response", tone: "active" });
    expect(currentAgentActivity("ready", [tool])).toBeNull();

    expect(toolActivity({ ...tool, state: "output-available", output: { id: "record-1" } }))
      .toEqual({ label: "Searching gigs complete", tone: "success" });
    expect(toolActivity({ ...tool, state: "output-error", errorText: "private failure" }))
      .toEqual({ label: "Searching gigs failed", tone: "error" });
    expect(toolActivity({ ...tool, state: "output-denied", approval: { id: "approval-1", approved: false } }))
      .toEqual({ label: "Searching gigs cancelled", tone: "cancelled" });
  });

  test("keeps activity visible throughout submitted and streaming states", () => {
    expect(currentAgentActivity("submitted")).toEqual({ label: "Thinking", tone: "active" });
    expect(currentAgentActivity("submitted", [{ type: "text", text: "A prior answer." }]))
      .toEqual({ label: "Thinking", tone: "active" });
    expect(currentAgentActivity("streaming")).toEqual({ label: "Working", tone: "active" });
    expect(currentAgentActivity("error")).toBeNull();
  });

  test("new empty reasoning and text parts supersede completed tool activity", () => {
    const completedTool = {
      type: "dynamic-tool" as const,
      toolName: "get_document",
      toolCallId: "call-complete",
      state: "output-available" as const,
      input: {},
      output: { status: "ok" },
    };
    expect(currentAgentActivity("streaming", [completedTool, {
      type: "reasoning", text: "",
    }])).toEqual({ label: "Thinking", tone: "active" });
    expect(currentAgentActivity("streaming", [completedTool, {
      type: "text", text: "",
    }])).toEqual({ label: "Writing response", tone: "active" });
  });

  test("presents staged attachments without their transport reference", () => {
    expect(userMessageText([{
      type: "text",
      text: "Review this.\n\nAttached staged document: staged-document:11111111-1111-4111-8111-111111111111",
    }])).toBe("Review this.\n\nAttached document");
    expect(userMessageText([{
      type: "text",
      text: "Review this.\n\nAttached staged document: [attached document]",
    }])).toBe("Review this.\n\nAttached document");
  });
});

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
