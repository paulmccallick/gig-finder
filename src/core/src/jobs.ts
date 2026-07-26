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

export interface JobRole {
  id: string;
  company: string;
  title: string;
  jobId: string | null;
  roleDirectory: string | null;
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

export interface Job extends JobRole {
  location: string | null;
  workArrangement: string | null;
  postedDate: string | null;
  businessUnitTeam: string | null;
  recruiterSource: string | null;
  bonus: string | null;
  equity: string | null;
  otherCompensation: string | null;
}
