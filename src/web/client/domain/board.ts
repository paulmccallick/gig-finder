import type { FitRating, GigSummary, Outcome, PipelineStage } from "../../../core/gigs";

export type BoardMode = "active" | "unavailable" | "archive";

export interface BoardFilters {
  search: string;
  stage: PipelineStage | "all";
  fit: FitRating | "all";
  overdueOnly: boolean;
}

export const activeStageOrder: PipelineStage[] = [
  "identified",
  "applied",
  "recruiter_contact",
  "screening",
  "technical_interview",
  "final_round",
  "offer",
  "monitoring",
];

export const archiveOutcomeOrder: Array<Outcome | "other"> = [
  "rejected",
  "not_pursuing",
  "role_pulled",
  "no_response",
  "other",
];

export const stageLabels: Record<PipelineStage, string> = {
  identified: "Identified",
  applied: "Applied",
  recruiter_contact: "Recruiter Contact",
  screening: "Screening",
  technical_interview: "Technical Interview",
  final_round: "Final Round",
  offer: "Offer",
  monitoring: "Monitoring",
  closed: "Closed",
};

export const outcomeLabels: Record<Outcome | "other", string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  not_pursuing: "Not Pursuing",
  role_pulled: "Role Pulled",
  no_response: "No Response",
  position_filled: "Position Filled",
  on_hold: "On Hold",
  stale_or_unverified: "Stale / Unverified",
  other: "Other",
};

export const fitLabels: Record<FitRating, string> = {
  strong: "Strong",
  good: "Good",
  stretch: "Stretch",
  long_shot: "Long Shot",
  weak: "Weak",
  poor: "Poor",
  support: "Support",
  tbd: "TBD",
  not_applicable: "N/A",
};

export function todayInPacific(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isOverdue(gig: GigSummary, today = todayInPacific()): boolean {
  return gig.stage !== "closed" && Boolean(gig.nextAction?.due && gig.nextAction.due < today);
}

function belongsToMode(gig: GigSummary, mode: BoardMode): boolean {
  if (mode === "archive") return gig.stage === "closed";
  if (gig.stage === "closed") return false;
  return mode === "unavailable"
    ? gig.availability === "unavailable"
    : gig.availability !== "unavailable";
}

export function filterGigs(
  gigs: GigSummary[],
  mode: BoardMode,
  filters: BoardFilters,
  today = todayInPacific(),
): GigSummary[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return gigs.filter((gig) => {
    if (!belongsToMode(gig, mode)) return false;
    if (filters.stage !== "all" && gig.stage !== filters.stage) return false;
    if (filters.fit !== "all" && gig.fit.rating !== filters.fit) return false;
    if (filters.overdueOnly && !isOverdue(gig, today)) return false;
    if (!query) return true;
    return [gig.company, gig.title, gig.statusSummary, gig.nextAction?.description]
      .filter(Boolean)
      .some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

export function compareGigs(a: GigSummary, b: GigSummary, today = todayInPacific()): number {
  const overdueDifference = Number(isOverdue(b, today)) - Number(isOverdue(a, today));
  if (overdueDifference) return overdueDifference;
  const aDue = a.nextAction?.due ?? "9999-12-31";
  const bDue = b.nextAction?.due ?? "9999-12-31";
  if (aDue !== bDue) return aDue.localeCompare(bDue);
  if (a.lastActivity !== b.lastActivity) return b.lastActivity.localeCompare(a.lastActivity);
  return a.company.localeCompare(b.company);
}

export function compareUnavailableGigs(a: GigSummary, b: GigSummary): number {
  const timestampDifference = (b.availabilityUpdatedAt ?? "")
    .localeCompare(a.availabilityUpdatedAt ?? "");
  return timestampDifference || compareGigs(a, b);
}

export function formatUnavailableSince(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(instant);
}

export function archiveGroup(gig: GigSummary): Outcome | "other" {
  return gig.outcome && archiveOutcomeOrder.includes(gig.outcome) ? gig.outcome : "other";
}

export function formatPay(gig: GigSummary): string | null {
  const pay = gig.payRange;
  if (!pay) return null;
  const format = (value: number | null) =>
    value === null
      ? null
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: pay.currency,
          maximumFractionDigits: 0,
          notation: value >= 100_000 ? "compact" : "standard",
        }).format(value);
  const minimum = format(pay.minimum);
  const maximum = format(pay.maximum);
  const range = minimum && maximum ? `${minimum}–${maximum}` : minimum ?? maximum ?? "Unspecified";
  return `${range}/${pay.period === "year" ? "yr" : "hr"}`;
}
