export const agentLayouts = ["panel", "full"] as const;

export type AgentLayout = (typeof agentLayouts)[number];

export const defaultAgentPanelWidth = 450;
export const minimumAgentPanelWidth = 340;
export const maximumAgentPanelWidth = 720;

export function constrainAgentPanelWidth(width: number, viewportWidth: number) {
  const availableWidth = Math.max(minimumAgentPanelWidth, viewportWidth - 320);
  return Math.round(Math.min(
    maximumAgentPanelWidth,
    availableWidth,
    Math.max(minimumAgentPanelWidth, width),
  ));
}

export interface AgentWorkspaceState {
  open: boolean;
  layout: AgentLayout;
}

export type AgentWorkspaceAction =
  | { type: "close" }
  | { type: "toggle" }
  | { type: "set-layout"; layout: AgentLayout };

export const initialAgentWorkspace: AgentWorkspaceState = {
  open: true,
  layout: "panel",
};

export function updateAgentWorkspace(
  state: AgentWorkspaceState,
  action: AgentWorkspaceAction,
): AgentWorkspaceState {
  switch (action.type) {
    case "close":
      return { ...state, open: false };
    case "toggle":
      return { ...state, open: !state.open };
    case "set-layout":
      return { ...state, layout: action.layout };
  }
}
