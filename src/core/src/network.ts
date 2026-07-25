export const contactPriorities = ["high", "medium", "low", "unranked"] as const;
export type ContactPriority = (typeof contactPriorities)[number];
export const relationshipStrengths = ["strong", "warm", "limited", "unknown"] as const;
export type RelationshipStrength = (typeof relationshipStrengths)[number];

export const contactStatuses = [
  "not_contacted", "outreach_planned", "outreach_sent", "awaiting_response",
  "conversation_scheduled", "active_relationship", "follow_up_due", "paused", "do_not_contact",
] as const;
export type ContactStatus = (typeof contactStatuses)[number];

export interface NetworkContact {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  linkedInProfileUrl: string | null;
  profileStatus: "missing" | "verified";
  hasLocalProfile?: boolean;
  connectedOn: string | null;
  relationship: { type: string; strength: RelationshipStrength; introducedBy: string | null; notes: string | null };
  priority: ContactPriority;
  status: ContactStatus;
  outreach: { lastContacted: string | null; lastContactMethod: string | null; lastContactSummary: string | null; nextAction: string | null; nextActionDue: string | null };
  whyInteresting: string | null;
  notes: string[];
  tags: string[];
  source: { files: string[] };
  createdAt: string;
  updatedAt: string;
}

export const statusLabels: Record<ContactStatus, string> = {
  not_contacted: "Not Contacted", outreach_planned: "Outreach Planned", outreach_sent: "Outreach Sent",
  awaiting_response: "Awaiting Response", conversation_scheduled: "Meeting Scheduled", active_relationship: "Active Relationship",
  follow_up_due: "Follow-up Due", paused: "Paused", do_not_contact: "Do Not Contact",
};

export const priorityLabels: Record<ContactPriority, string> = { high: "High", medium: "Medium", low: "Low", unranked: "Unranked" };

export function contactIsOverdue(contact: NetworkContact, today: string): boolean {
  return Boolean(contact.outreach.nextActionDue && contact.outreach.nextActionDue < today && !["paused", "do_not_contact"].includes(contact.status));
}

export function compareContacts(a: NetworkContact, b: NetworkContact, today: string): number {
  const overdue = Number(contactIsOverdue(b, today)) - Number(contactIsOverdue(a, today));
  if (overdue) return overdue;
  const priority = contactPriorities.indexOf(a.priority) - contactPriorities.indexOf(b.priority);
  if (priority) return priority;
  return (a.outreach.nextActionDue ?? "9999-12-31").localeCompare(b.outreach.nextActionDue ?? "9999-12-31") || a.name.localeCompare(b.name);
}
