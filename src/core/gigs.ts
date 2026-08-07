import { z } from "zod";
import { isCalendarDate } from "./queries";
import type { DocumentSummary } from "./documents";
import type { InteractionReference } from "./interactions";

export const pipelineStages = [
  "identified",
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
  "final_round",
  "offer",
  "monitoring",
  "closed",
] as const;

export type PipelineStage = (typeof pipelineStages)[number];

export const outcomes = [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
  "not_pursuing",
  "role_pulled",
  "no_response",
  "position_filled",
  "on_hold",
  "stale_or_unverified",
] as const;

export type Outcome = (typeof outcomes)[number];

export const fitRatings = [
  "strong",
  "good",
  "stretch",
  "long_shot",
  "weak",
  "poor",
  "support",
  "tbd",
  "not_applicable",
] as const;

export type FitRating = (typeof fitRatings)[number];

export interface NextAction {
  description: string;
  due: string | null;
}

export interface Fit {
  rating: FitRating;
  summary: string | null;
}

export interface PayRange {
  currency: "USD";
  minimum: number | null;
  maximum: number | null;
  period: "hour" | "year";
  notes: string | null;
}

export interface GigSummary {
  id: string;
  company: string;
  title: string;
  externalJobId: string | null;
  artifactDirectory: string | null;
  stage: PipelineStage;
  outcome: Outcome;
  statusSummary: string;
  lastActivity: string;
  nextAction: NextAction | null;
  fit: Fit;
  payRange: PayRange | null;
  sourceUrl: string | null;
  tags: string[];
  hasJobDescription?: boolean;
  hasInterviewPrep?: boolean;
  location?: string | null;
  workArrangement?: string | null;
  postedDate?: string | null;
  businessUnitTeam?: string | null;
  recruiterSource?: string | null;
  bonus?: string | null;
  equity?: string | null;
  otherCompensation?: string | null;
}

export interface GigRecord extends Gig {
  documents: DocumentSummary[];
  interactions?: InteractionReference[];
}

const gigDateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"Must use YYYY-MM-DD.").refine(isCalendarDate,"Must be a valid calendar date.");
const gigNullableTextSchema=z.string().trim().nullable();
export const gigNextActionSchema=z.object({description:z.string().trim().min(1).describe("What the candidate should do next."),due:gigDateSchema.nullable().describe("Due date, or null.")}).strict();
export const gigFitSchema=z.object({rating:z.enum(fitRatings).describe("Candidate fit rating."),summary:gigNullableTextSchema.describe("Fit explanation, or null.")}).strict();
export const gigPayRangeSchema=z.object({currency:z.literal("USD").describe("Compensation currency."),minimum:z.number().nonnegative().nullable().describe("Minimum compensation, or null."),maximum:z.number().nonnegative().nullable().describe("Maximum compensation, or null."),period:z.enum(["hour","year"]).describe("Hourly or annual compensation."),notes:gigNullableTextSchema.describe("Compensation notes, or null.")}).strict();
const gigMutableFields={company:z.string().trim().min(1).describe("Company offering the role."),title:z.string().trim().min(1).describe("Role title."),externalJobId:gigNullableTextSchema.describe("External job ID, or null."),stage:z.enum(pipelineStages).describe("Pipeline stage."),outcome:z.enum(outcomes).describe("Pipeline outcome."),statusSummary:z.string().trim().min(1).describe("Current status summary."),lastActivity:gigDateSchema.describe("Most recent activity date."),nextAction:gigNextActionSchema.nullable().describe("Next action, or null."),fit:gigFitSchema.describe("Fit assessment."),payRange:gigPayRangeSchema.nullable().describe("Compensation, or null."),sourceUrl:z.string().url().nullable().describe("Canonical source URL, or null."),tags:z.array(z.string().trim().min(1)).describe("Replacement tag list."),location:gigNullableTextSchema.describe("Location, or null."),workArrangement:gigNullableTextSchema.describe("Work arrangement, or null."),postedDate:gigDateSchema.nullable().describe("Posted date, or null."),businessUnitTeam:gigNullableTextSchema.describe("Business unit or team, or null."),recruiterSource:gigNullableTextSchema.describe("Recruiter source, or null."),bonus:gigNullableTextSchema.describe("Bonus details, or null."),equity:gigNullableTextSchema.describe("Equity details, or null."),otherCompensation:gigNullableTextSchema.describe("Other compensation, or null.")};
export const gigEntitySchema=z.object({id:z.string().trim().min(1),...gigMutableFields,artifactDirectory:z.string().nullable(),hasJobDescription:z.boolean(),hasInterviewPrep:z.boolean()}).strict();
export type Gig=z.infer<typeof gigEntitySchema>;
export const gigInputSchema=gigEntitySchema.omit({id:true,artifactDirectory:true,hasJobDescription:true,hasInterviewPrep:true}).partial().extend({nextAction:z.object({description:gigNextActionSchema.shape.description.optional(),due:gigNextActionSchema.shape.due.optional()}).strict().refine(value=>Object.keys(value).length>0,"Next action input must contain at least one field.").nullable().optional().describe("Next action, or null."),fit:z.object({rating:gigFitSchema.shape.rating.optional(),summary:gigFitSchema.shape.summary.optional()}).strict().refine(value=>Object.keys(value).length>0,"Fit input must contain at least one field.").optional().describe("Fit assessment."),payRange:z.object({currency:gigPayRangeSchema.shape.currency.optional(),minimum:gigPayRangeSchema.shape.minimum.optional(),maximum:gigPayRangeSchema.shape.maximum.optional(),period:gigPayRangeSchema.shape.period.optional(),notes:gigPayRangeSchema.shape.notes.optional()}).strict().refine(value=>Object.keys(value).length>0,"Pay range input must contain at least one field.").nullable().optional().describe("Compensation, or null.")}).strict().refine(value=>Object.keys(value).length>0,"Gig input must contain at least one field.");
export type GigInput=z.infer<typeof gigInputSchema>;
export const gigInputFieldPaths=["company","title","externalJobId","stage","outcome","statusSummary","lastActivity","nextAction","nextAction.description","nextAction.due","fit.rating","fit.summary","payRange","payRange.currency","payRange.minimum","payRange.maximum","payRange.period","payRange.notes","sourceUrl","tags","location","workArrangement","postedDate","businessUnitTeam","recruiterSource","bonus","equity","otherCompensation"] as const;
export const gigClearableInputFieldPaths=new Set<typeof gigInputFieldPaths[number]>(["externalJobId","nextAction","nextAction.due","fit.summary","payRange","payRange.minimum","payRange.maximum","payRange.notes","sourceUrl","location","workArrangement","postedDate","businessUnitTeam","recruiterSource","bonus","equity","otherCompensation"]);
export const gigClearOnlyInputFieldPaths=new Set<typeof gigInputFieldPaths[number]>(["nextAction","payRange"]);
