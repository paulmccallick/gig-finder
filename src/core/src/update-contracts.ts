import { z } from "zod";
import { fitRatings, outcomes, pipelineStages } from "./gigs";
import {
  personPriorities,
  personStatuses,
  relationshipStrengths,
} from "./people";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD.");
const nullableText = z.string().trim().nullable();

const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T, message: string) =>
  z.object(shape).strict().refine(
    value => Object.keys(value).length > 0,
    message,
  );

const nextActionUpdateSchema = nonEmptyPatch({
  description: z.string().trim().min(1).optional()
    .describe("What the candidate should do next."),
  due: date.nullable().optional()
    .describe("Due date for the next action, or null to clear it."),
}, "Next-action update must contain at least one field.");

const fitUpdateSchema = nonEmptyPatch({
  rating: z.enum(fitRatings).optional()
    .describe("Candidate fit rating for this role."),
  summary: nullableText.optional()
    .describe("Explanation of the fit rating, or null to clear it."),
}, "Fit update must contain at least one field.");

const payRangeUpdateSchema = nonEmptyPatch({
  currency: z.literal("USD").optional()
    .describe("Compensation currency."),
  minimum: z.number().nonnegative().nullable().optional()
    .describe("Minimum base compensation, or null to clear it."),
  maximum: z.number().nonnegative().nullable().optional()
    .describe("Maximum base compensation, or null to clear it."),
  period: z.enum(["hour", "year"]).optional()
    .describe("Whether compensation is hourly or annual."),
  notes: nullableText.optional()
    .describe("Additional compensation notes, or null to clear them."),
}, "Pay-range update must contain at least one field.");

export const gigUpdateSchema = nonEmptyPatch({
  company: z.string().trim().min(1).optional()
    .describe("Company offering the role."),
  title: z.string().trim().min(1).optional()
    .describe("Role title."),
  externalJobId: nullableText.optional()
    .describe("Company or recruiting-system gig identifier, or null to clear it."),
  stage: z.enum(pipelineStages).optional()
    .describe("Current gig-finder pipeline stage."),
  outcome: z.enum(outcomes).optional()
    .describe("Current outcome; non-closed gigs must remain pending."),
  statusSummary: z.string().trim().min(1).optional()
    .describe("Concise summary of the current status."),
  lastActivity: date.optional()
    .describe("Date of the most recent activity."),
  nextAction: nextActionUpdateSchema.nullable().optional()
    .describe("Next action fields, or null to clear the next action."),
  fit: fitUpdateSchema.optional()
    .describe("Candidate fit assessment fields."),
  payRange: payRangeUpdateSchema.nullable().optional()
    .describe("Compensation range fields, or null to clear compensation."),
  sourceUrl: z.string().url().nullable().optional()
    .describe("Canonical source URL, or null to clear it."),
  tags: z.array(z.string().trim().min(1)).optional()
    .describe("Complete replacement list of gig tags."),
  location: nullableText.optional()
    .describe("Role location, or null to clear it."),
  workArrangement: nullableText.optional()
    .describe("Remote, hybrid, or on-site arrangement, or null to clear it."),
  postedDate: date.nullable().optional()
    .describe("Date the role was posted, or null to clear it."),
  businessUnitTeam: nullableText.optional()
    .describe("Business unit or team, or null to clear it."),
  recruiterSource: nullableText.optional()
    .describe("Recruiter or sourcing channel, or null to clear it."),
  bonus: nullableText.optional()
    .describe("Bonus information, or null to clear it."),
  equity: nullableText.optional()
    .describe("Equity information, or null to clear it."),
  otherCompensation: nullableText.optional()
    .describe("Other compensation information, or null to clear it."),
}, "Gig update must contain at least one field.");

const relationshipUpdateSchema = nonEmptyPatch({
  type: z.string().trim().min(1).optional()
    .describe("How the candidate knows this person."),
  strength: z.enum(relationshipStrengths).optional()
    .describe("Current relationship strength."),
  introducedBy: nullableText.optional()
    .describe("Who introduced the candidate, or null to clear it."),
  notes: nullableText.optional()
    .describe("Relationship notes, or null to clear them."),
}, "Relationship update must contain at least one field.");

const outreachUpdateSchema = nonEmptyPatch({
  lastContacted: date.nullable().optional()
    .describe("Date of the latest contact, or null to clear it."),
  lastContactMethod: nullableText.optional()
    .describe("Method used for the latest contact, or null to clear it."),
  lastContactSummary: nullableText.optional()
    .describe("Summary of the latest contact, or null to clear it."),
  nextAction: nullableText.optional()
    .describe("Next outreach action, or null to clear it."),
  nextActionDue: date.nullable().optional()
    .describe("Due date for the next action, or null to clear it."),
}, "Outreach update must contain at least one field.");

export const personUpdateSchema = nonEmptyPatch({
  name: z.string().trim().min(1).optional()
    .describe("Person's name."),
  company: nullableText.optional()
    .describe("Person's company, or null to clear it."),
  title: nullableText.optional()
    .describe("Person's title, or null to clear it."),
  linkedInProfileUrl: z.string().url().nullable().optional()
    .describe("LinkedIn profile URL, or null to clear it."),
  connectedOn: date.nullable().optional()
    .describe("Date the connection was established, or null to clear it."),
  relationship: relationshipUpdateSchema.optional()
    .describe("Relationship fields to update."),
  priority: z.enum(personPriorities).optional()
    .describe("Relationship priority."),
  status: z.enum(personStatuses).optional()
    .describe("Current relationship or outreach status."),
  outreach: outreachUpdateSchema.optional()
    .describe("Outreach fields to update."),
  whyInteresting: nullableText.optional()
    .describe("Why this person matters to the search, or null to clear it."),
  notes: z.array(z.string()).optional()
    .describe("Complete replacement list of person notes."),
  tags: z.array(z.string().trim().min(1)).optional()
    .describe("Complete replacement list of person tags."),
}, "Person update must contain at least one field.");

export type GigUpdate = z.infer<typeof gigUpdateSchema>;
export type PersonUpdate = z.infer<typeof personUpdateSchema>;
