import type { DocumentSummary } from "./documents";
import { z } from "zod";
import { isCalendarDate } from "./queries";

export const personPriorities = ["high", "medium", "low", "unranked"] as const;
export type PersonPriority = (typeof personPriorities)[number];
export const relationshipStrengths = ["strong", "warm", "limited", "unknown"] as const;
export type RelationshipStrength = (typeof relationshipStrengths)[number];
export const personStatuses = [
  "not_contacted", "outreach_planned", "outreach_sent", "awaiting_response",
  "conversation_scheduled", "active_relationship", "follow_up_due", "paused", "do_not_contact",
] as const;
export type PersonStatus = (typeof personStatuses)[number];

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

export { gigPersonRelationships, type GigPersonRelationship, type GigPersonRelationshipInput, type GigPersonRelationshipType } from "./gig-people";

const personDateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"Must use YYYY-MM-DD.").refine(isCalendarDate,"Must be a valid calendar date.");
const personNullableTextSchema=z.string().trim().nullable();
export const personRelationshipSchema=z.object({type:z.string().trim().min(1).describe("How the candidate knows this person."),strength:z.enum(relationshipStrengths).describe("Relationship strength."),introducedBy:personNullableTextSchema.describe("Introducer, or null."),notes:personNullableTextSchema.describe("Relationship notes, or null.")}).strict().describe("Relationship details.");
export const personOutreachSchema=z.object({lastContacted:personDateSchema.nullable().describe("Last-contact date, or null."),lastContactMethod:personNullableTextSchema.describe("Last-contact method, or null."),lastContactSummary:personNullableTextSchema.describe("Last-contact summary, or null."),nextAction:personNullableTextSchema.describe("Next action, or null."),nextActionDue:personDateSchema.nullable().describe("Next-action due date, or null.")}).strict().describe("Outreach state.");
const personMutableFields={name:z.string().trim().min(1).describe("Person name."),company:personNullableTextSchema.describe("Company, or null."),title:personNullableTextSchema.describe("Title, or null."),linkedInProfileUrl:z.string().url().nullable().describe("LinkedIn profile URL, or null."),connectedOn:personDateSchema.nullable().describe("Connection date, or null."),relationship:personRelationshipSchema.describe("Relationship details."),priority:z.enum(personPriorities).describe("Relationship priority."),status:z.enum(personStatuses).describe("Outreach status."),outreach:personOutreachSchema.describe("Outreach state."),whyInteresting:personNullableTextSchema.describe("Why this person matters, or null."),notes:z.array(z.string()).describe("Replacement notes list."),tags:z.array(z.string().trim().min(1)).describe("Replacement tags list.")};
export const personEntitySchema=z.object({id:z.string().trim().min(1),...personMutableFields,profileStatus:z.enum(["missing","verified"]),createdAt:personDateSchema,updatedAt:personDateSchema}).strict();
export type Person=z.infer<typeof personEntitySchema>;
export const personInputSchema=z.object({name:personMutableFields.name.optional(),company:personMutableFields.company.optional(),title:personMutableFields.title.optional(),linkedInProfileUrl:personMutableFields.linkedInProfileUrl.optional(),connectedOn:personMutableFields.connectedOn.optional(),relationship:z.object({type:personRelationshipSchema.shape.type.optional(),strength:personRelationshipSchema.shape.strength.optional(),introducedBy:personRelationshipSchema.shape.introducedBy.optional(),notes:personRelationshipSchema.shape.notes.optional()}).strict().refine(value=>Object.keys(value).length>0,"Relationship input must contain at least one field.").optional().describe("Relationship details."),priority:personMutableFields.priority.optional(),status:personMutableFields.status.optional(),outreach:z.object({lastContacted:personOutreachSchema.shape.lastContacted.optional(),lastContactMethod:personOutreachSchema.shape.lastContactMethod.optional(),lastContactSummary:personOutreachSchema.shape.lastContactSummary.optional(),nextAction:personOutreachSchema.shape.nextAction.optional(),nextActionDue:personOutreachSchema.shape.nextActionDue.optional()}).strict().refine(value=>Object.keys(value).length>0,"Outreach input must contain at least one field.").optional().describe("Outreach state."),whyInteresting:personMutableFields.whyInteresting.optional(),notes:personMutableFields.notes.optional(),tags:personMutableFields.tags.optional()}).strict().refine(value=>Object.keys(value).length>0,"Person input must contain at least one field.");
export type PersonInput=z.infer<typeof personInputSchema>;
export const personInputFieldPaths=["name","company","title","linkedInProfileUrl","connectedOn","relationship.type","relationship.strength","relationship.introducedBy","relationship.notes","priority","status","outreach.lastContacted","outreach.lastContactMethod","outreach.lastContactSummary","outreach.nextAction","outreach.nextActionDue","whyInteresting","notes","tags"] as const;
export const personClearableInputFieldPaths=new Set<typeof personInputFieldPaths[number]>(["company","title","linkedInProfileUrl","connectedOn","relationship.introducedBy","relationship.notes","outreach.lastContacted","outreach.lastContactMethod","outreach.lastContactSummary","outreach.nextAction","outreach.nextActionDue","whyInteresting"]);
