import { DomainValidationError } from "./errors";
import type { FitRating, Outcome, PipelineStage } from "./gigs";
import type {
  PersonPriority,
  PersonStatus,
  RelationshipStrength,
} from "./people";
import type { GigPersonRelationshipType } from "./people";
import type { InteractionChannel, InteractionDirection, InteractionKind, InteractionStatus } from "./interactions";
import type {
  TaskPriority,
  TaskRecord,
  TaskStatus,
  TaskType,
} from "./tasks";

export interface PageInput {
  offset?: number;
  limit?: number;
}

export interface PageMetadata {
  offset: number;
  limit: number;
  returned: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface Page<T> {
  items: T[];
  page: PageMetadata;
}

export interface GigQueryInput extends PageInput {
  stages?: PipelineStage[];
  outcomes?: Outcome[];
  fitRatings?: FitRating[];
  overdueOnly?: boolean;
  query?: string;
}

export interface PeopleQueryInput extends PageInput {
  statuses?: PersonStatus[];
  priorities?: PersonPriority[];
  relationshipStrengths?: RelationshipStrength[];
  overdueOnly?: boolean;
  query?: string;
}

export interface TaskQueryInput extends PageInput {
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  types?: TaskType[];
  relatedEntityType?: TaskRecord["relatedEntity"]["type"];
  relatedEntityId?: string;
  overdueOnly?: boolean;
  query?: string;
}

export interface GigPersonRelationshipQueryInput extends PageInput {
  gigIds?: string[];
  personIds?: string[];
  relationships?: GigPersonRelationshipType[];
}

export interface InteractionQueryInput extends PageInput {
  personIds?: string[];
  gigIds?: string[];
  kinds?: InteractionKind[];
  channels?: InteractionChannel[];
  directions?: InteractionDirection[];
  statuses?: InteractionStatus[];
  startsFrom?: string;
  startsThrough?: string;
  query?: string;
}

export type ReadResult<T> =
  | { status: "ok"; record: T }
  | { status: "not_found"; id: string }
  | { status: "consistency_error"; id: string; message: string };

export type PageResult<T> =
  | ({ status: "ok" } & Page<T>)
  | { status: "consistency_error"; id: string; message: string };

export const normalizedQuery = (query?: string) =>
  query?.trim().toLocaleLowerCase() ?? "";

export const matchesQuery = (
  query: string,
  values: Array<string | null | undefined>,
) => !query || values.some(value => value?.toLocaleLowerCase().includes(query));

export const hasMeaningfulFilters = (
  input: Record<string, unknown>,
  ignored: readonly string[] = ["offset", "limit"],
) => Object.entries(input).some(([key, value]) =>
  !ignored.includes(key)
  && value !== undefined
  && value !== false
  && value !== ""
);

export function page<T>(items: T[], input: PageInput): Page<T> {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new DomainValidationError("Page offset must be a non-negative integer.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new DomainValidationError("Page limit must be an integer from 1 to 50.");
  }
  const selected = items.slice(offset, offset + limit);
  const hasMore = offset + selected.length < items.length;
  return {
    items: selected,
    page: {
      offset,
      limit,
      returned: selected.length,
      total: items.length,
      hasMore,
      nextOffset: hasMore ? offset + selected.length : null,
    },
  };
}

export function pacificDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const calendarDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: string) {
  if (!calendarDatePattern.test(value)) return false;
  const instant = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant.getTime())
    && instant.toISOString().slice(0, 10) === value;
}
