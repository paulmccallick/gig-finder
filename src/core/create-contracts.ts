import { z } from "zod";
import { fitRatings, outcomes, pipelineStages } from "./gigs";
import { gigPersonRelationships, personPriorities, personStatuses, relationshipStrengths } from "./people";
import { isCalendarDate } from "./queries";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD.")
  .refine(isCalendarDate, "Must be a valid calendar date.");
const nullableText = z.string().trim().min(1).nullable();

export const gigCreateSchema = z.object({
  company: z.string().trim().min(1).describe("Employer name."), title: z.string().trim().min(1).describe("Role title."), externalJobId: nullableText.describe("External job ID, or null."),
  stage: z.enum(pipelineStages).describe("Pipeline stage."), outcome: z.enum(outcomes).describe("Pipeline outcome."), statusSummary: z.string().trim().min(1).describe("Current status summary."),
  lastActivity: date.describe("Last activity date."),
  nextAction: z.object({ description: z.string().trim().min(1), due: date.nullable() }).strict().nullable().describe("Next action, or null."),
  fit: z.object({ rating: z.enum(fitRatings), summary: nullableText }).strict().describe("Candidate fit assessment."),
  payRange: z.object({ currency: z.literal("USD"), minimum: z.number().nonnegative().nullable(), maximum: z.number().nonnegative().nullable(), period: z.enum(["hour", "year"]), notes: nullableText }).strict().nullable().describe("Compensation range, or null."),
  sourceUrl: nullableText.describe("Source URL, or null."), tags: z.array(z.string().trim().min(1)).max(50).describe("Search tags."), location: nullableText.describe("Location, or null."),
  workArrangement: nullableText.describe("Work arrangement, or null."), postedDate: date.nullable().describe("Posted date, or null."), businessUnitTeam: nullableText.describe("Business unit or team, or null."),
  recruiterSource: nullableText.describe("Recruiter source, or null."), bonus: nullableText.describe("Bonus details, or null."), equity: nullableText.describe("Equity details, or null."), otherCompensation: nullableText.describe("Other compensation, or null."),
}).strict();
export type GigCreateInput = z.infer<typeof gigCreateSchema>;

export const personCreateSchema = z.object({
  name: z.string().trim().min(1).describe("Person name."), company: nullableText.describe("Company, or null."), title: nullableText.describe("Title, or null."),
  linkedInProfileUrl: nullableText.describe("LinkedIn profile URL, or null."), connectedOn: date.nullable().describe("Connection date, or null."), relationshipType: nullableText.describe("Relationship type, or null for the default."),
  relationshipStrength: z.enum(relationshipStrengths).nullable().describe("Relationship strength, or null for the default."), introducedBy: nullableText.describe("Introducer, or null."),
  relationshipNotes: nullableText.describe("Relationship notes, or null."), priority: z.enum(personPriorities).nullable().describe("Priority, or null for the default."),
  status: z.enum(personStatuses).nullable().describe("Outreach status, or null for the default."), lastContacted: date.nullable().describe("Last-contact date, or null."), lastContactMethod: nullableText.describe("Last-contact method, or null."),
  lastContactSummary: nullableText.describe("Last-contact summary, or null."), nextAction: nullableText.describe("Next action, or null."), nextActionDue: date.nullable().describe("Next-action due date, or null."),
  whyInteresting: nullableText.describe("Why this person matters, or null."), notes: z.array(z.string().trim().min(1)).max(100).describe("Private factual notes about the person."),
  tags: z.array(z.string().trim().min(1)).max(100).describe("Search and relationship tags."),
}).strict();
export type PersonCreateContractInput = z.infer<typeof personCreateSchema>;

export const gigPersonCreateSchema = z.object({
  gigId: z.string().trim().min(1).max(200).describe("Exact existing Gig ID."), personId: z.string().trim().min(1).max(200).describe("Exact existing Person ID."),
  relationship: z.enum(gigPersonRelationships).describe("Typed relationship."), notes: nullableText.describe("Relationship notes, or null."),
}).strict();
export type GigPersonCreateInput = z.infer<typeof gigPersonCreateSchema>;
