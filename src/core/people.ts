import type { DocumentSummary } from "./documents";

export const personPriorities = ["high", "medium", "low", "unranked"] as const;
export type PersonPriority = (typeof personPriorities)[number];
export const relationshipStrengths = ["strong", "warm", "limited", "unknown"] as const;
export type RelationshipStrength = (typeof relationshipStrengths)[number];
export const personStatuses = [
  "not_contacted", "outreach_planned", "outreach_sent", "awaiting_response",
  "conversation_scheduled", "active_relationship", "follow_up_due", "paused", "do_not_contact",
] as const;
export type PersonStatus = (typeof personStatuses)[number];

export interface Person {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  linkedInProfileUrl: string | null;
  profileStatus: "missing" | "verified";
  connectedOn: string | null;
  relationship: {
    type: string;
    strength: RelationshipStrength;
    introducedBy: string | null;
    notes: string | null;
  };
  priority: PersonPriority;
  status: PersonStatus;
  outreach: {
    lastContacted: string | null;
    lastContactMethod: string | null;
    lastContactSummary: string | null;
    nextAction: string | null;
    nextActionDue: string | null;
  };
  whyInteresting: string | null;
  notes: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PersonRecord extends Person {
  hasProfile: boolean;
  documents: DocumentSummary[];
}

export const statusLabels: Record<PersonStatus, string> = {
  not_contacted: "Not Contacted", outreach_planned: "Outreach Planned", outreach_sent: "Outreach Sent",
  awaiting_response: "Awaiting Response", conversation_scheduled: "Meeting Scheduled", active_relationship: "Active Relationship",
  follow_up_due: "Follow-up Due", paused: "Paused", do_not_contact: "Do Not Contact",
};
export const priorityLabels: Record<PersonPriority, string> = { high: "High", medium: "Medium", low: "Low", unranked: "Unranked" };

export function personIsOverdue(person: Person, today: string): boolean {
  return Boolean(person.outreach.nextActionDue && person.outreach.nextActionDue < today && !["paused", "do_not_contact"].includes(person.status));
}

export function comparePeople(a: Person, b: Person, today: string): number {
  const overdue = Number(personIsOverdue(b, today)) - Number(personIsOverdue(a, today));
  if (overdue) return overdue;
  const priority = personPriorities.indexOf(a.priority) - personPriorities.indexOf(b.priority);
  if (priority) return priority;
  return (a.outreach.nextActionDue ?? "9999-12-31").localeCompare(b.outreach.nextActionDue ?? "9999-12-31") || a.name.localeCompare(b.name);
}

export const gigPersonRelationships = [
  "interviewer",
  "hiring_manager",
  "recruiter",
  "recruiting_coordinator",
  "employee",
  "former_peer",
  "professional_contact",
  "personal_contact",
] as const;

export type GigPersonRelationshipType = typeof gigPersonRelationships[number];

export interface GigPersonRelationship {
  id: string;
  gigId: string;
  personId: string;
  relationship: GigPersonRelationshipType;
  notes: string | null;
}
