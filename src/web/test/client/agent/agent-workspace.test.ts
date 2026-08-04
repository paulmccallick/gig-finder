import { describe, expect, test } from "bun:test";
import {
  constrainAgentPanelWidth,
  defaultAgentPanelWidth,
  initialAgentWorkspace,
  updateAgentWorkspace,
} from "../../../client/agent/agent-workspace";

describe("agent workspace state", () => {
  test("starts open in the side panel", () => {
    expect(initialAgentWorkspace).toEqual({ open: true, layout: "panel" });
  });

  test("keeps the selected layout when closed and reopened", () => {
    const expanded = updateAgentWorkspace(initialAgentWorkspace, {
      type: "set-layout",
      layout: "full",
    });
    const closed = updateAgentWorkspace(expanded, { type: "close" });
    const reopened = updateAgentWorkspace(closed, { type: "toggle" });

    expect(closed).toEqual({ open: false, layout: "full" });
    expect(reopened).toEqual({ open: true, layout: "full" });
  });

  test("switches directly between every supported layout", () => {
    const full = updateAgentWorkspace(initialAgentWorkspace, {
      type: "set-layout",
      layout: "full",
    });
    const panel = updateAgentWorkspace(full, {
      type: "set-layout",
      layout: "panel",
    });

    expect(full.layout).toBe("full");
    expect(panel.layout).toBe("panel");
  });

  test("constrains side-panel resizing to the usable viewport", () => {
    expect(constrainAgentPanelWidth(defaultAgentPanelWidth + 150, 1440)).toBe(600);
    expect(constrainAgentPanelWidth(100, 1440)).toBe(340);
    expect(constrainAgentPanelWidth(900, 1440)).toBe(720);
    expect(constrainAgentPanelWidth(600, 760)).toBe(440);
  });
});
