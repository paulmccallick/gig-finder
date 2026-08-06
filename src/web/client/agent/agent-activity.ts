import { getToolName, isToolUIPart, type UIMessage } from "ai";

export const agentToolLabels = {
  search_gigs_and_people: "Searching gigs and people",
  list_gigs: "Searching gigs",
  get_gig: "Reading gig",
  list_people: "Searching people",
  get_person: "Reading person",
  list_gig_person_relationships: "Searching relationships",
  get_gig_person_relationship: "Reading relationship",
  list_tasks: "Searching tasks",
  get_task: "Reading task",
  list_interactions: "Searching interactions",
  get_interaction: "Reading interaction",
  list_documents: "Searching documents",
  list_document_versions: "Reading document history",
  get_document: "Reading document",
  create_gig: "Saving gig",
  update_gig: "Updating gig",
  update_person: "Updating person",
  create_person: "Saving person",
  create_gig_person_relationship: "Saving relationship",
  create_task: "Saving task",
  update_task: "Updating task",
  create_interaction: "Saving interaction",
  update_interaction: "Updating interaction",
  delete_interaction: "Deleting interaction",
  create_document: "Saving document",
  update_document: "Updating document",
  revert_change: "Undoing change",
} as const;

export type AgentToolName = keyof typeof agentToolLabels;
export type AgentActivityTone = "active" | "success" | "error" | "cancelled";

export interface AgentActivity {
  label: string;
  tone: AgentActivityTone;
}

export function toolActivity(part: UIMessage["parts"][number]): AgentActivity | null {
  if (!isToolUIPart(part)) return null;
  const toolName = getToolName(part);
  const label = toolName in agentToolLabels
    ? agentToolLabels[toolName as AgentToolName]
    : "Working";
  switch (part.state) {
    case "output-available": return { label: `${label} complete`, tone: "success" };
    case "output-error": return { label: `${label} failed`, tone: "error" };
    case "output-denied": return { label: `${label} cancelled`, tone: "cancelled" };
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return { label, tone: "active" };
  }
}

export function currentAgentActivity(
  status: "submitted" | "streaming" | "ready" | "error",
  parts: UIMessage["parts"] = [],
): AgentActivity | null {
  if (status !== "submitted" && status !== "streaming") return null;
  if (status === "submitted") return { label: "Thinking", tone: "active" };
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) continue;
    const tool = toolActivity(part);
    if (tool) return tool;
    if (part.type === "reasoning") {
      return { label: "Thinking", tone: "active" };
    }
    if (part.type === "text") {
      return { label: "Writing response", tone: "active" };
    }
  }
  return { label: "Working", tone: "active" };
}
