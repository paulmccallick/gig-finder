import { z } from "zod";
import { fitRatings, outcomes, pipelineStages } from "../core/src/gigs";
import {
  personPriorities,
  personStatuses,
  relationshipStrengths,
} from "../core/src/people";
import { meetingStatuses } from "../core/src/meetings";
import { taskPriorities, taskStatuses, taskTypes } from "../core/src/tasks";
import { taskRelatedEntityInputSchema } from "../core/src/update-contracts";

const updateValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.null(),
]);

const gigUpdateFields = [
  "company", "title", "externalJobId", "stage", "outcome", "statusSummary",
  "lastActivity", "nextAction", "nextAction.description", "nextAction.due",
  "fit.rating", "fit.summary", "payRange", "payRange.currency",
  "payRange.minimum", "payRange.maximum", "payRange.period",
  "payRange.notes", "sourceUrl", "tags", "location", "workArrangement",
  "postedDate", "businessUnitTeam", "recruiterSource", "bonus", "equity",
  "otherCompensation",
] as const;

const personUpdateFields = [
  "name", "company", "title", "linkedInProfileUrl", "connectedOn",
  "relationship.type", "relationship.strength", "relationship.introducedBy",
  "relationship.notes", "priority", "status", "outreach.lastContacted",
  "outreach.lastContactMethod", "outreach.lastContactSummary",
  "outreach.nextAction", "outreach.nextActionDue", "whyInteresting", "notes",
  "tags",
] as const;

const meetingUpdateFields = [
  "title", "startsAt", "endsAt", "timezone", "status", "personIds",
  "gigId", "location", "description",
] as const;

const taskUpdateFields = [
  "title", "type", "status", "priority", "dueDate", "relatedEntity", "notes",
] as const;

const list = (values: readonly string[]) => values.join(", ");

const gigFieldDescription = [
  "Exact mutable gig field path; nested fields use dot notation.",
  `stage values: ${list(pipelineStages)}.`,
  `outcome values: ${list(outcomes)}.`,
  `fit.rating values: ${list(fitRatings)}.`,
  "payRange.currency: USD; payRange.period: hour or year.",
].join(" ");

const gigValueDescription = [
  "Value appropriate to the selected gig field.",
  `For stage use one of: ${list(pipelineStages)}.`,
  `For outcome use one of: ${list(outcomes)}.`,
  `For fit.rating use one of: ${list(fitRatings)}.`,
  "Use YYYY-MM-DD for date fields, a valid URL for sourceUrl,",
  "nonnegative numbers for payRange.minimum or payRange.maximum,",
  "and a string array for tags.",
  "For clear operations use null; only nullable fields can be cleared.",
].join(" ");

const personFieldDescription = [
  "Exact mutable person field path; nested fields use dot notation.",
  `status values: ${list(personStatuses)}.`,
  `priority values: ${list(personPriorities)}.`,
  `relationship.strength values: ${list(relationshipStrengths)}.`,
].join(" ");

const personValueDescription = [
  "Value appropriate to the selected person field.",
  `For status use one of: ${list(personStatuses)}.`,
  `For priority use one of: ${list(personPriorities)}.`,
  `For relationship.strength use one of: ${list(relationshipStrengths)}.`,
  "Use YYYY-MM-DD for date fields, a valid URL for linkedInProfileUrl,",
  "and a string array for notes or tags.",
  "For clear operations use null; only nullable fields can be cleared.",
].join(" ");

const meetingFieldDescription = [
  "Exact mutable meeting field.",
  `status values: ${list(meetingStatuses)}.`,
  "personIds replaces the complete participant list.",
].join(" ");

const meetingValueDescription = [
  "Value appropriate to the selected meeting field.",
  `For status use one of: ${list(meetingStatuses)}.`,
  "Use ISO 8601 timestamps with offsets for startsAt and endsAt,",
  "an exact durable ID for gigId, and a string array of exact durable Person IDs for personIds.",
  "For clear operations use null; only gigId, location, and description can be cleared.",
].join(" ");

const taskFieldDescription = [
  "Exact mutable task field.",
  `type values: ${list(taskTypes)}.`,
  `status values: ${list(taskStatuses)}.`,
  `priority values: ${list(taskPriorities)}.`,
  "relatedEntity replaces the complete Gig, Person, or general relationship.",
].join(" ");

const taskValueDescription = [
  "Value appropriate to the selected task field.",
  `For type use one of: ${list(taskTypes)}.`,
  `For status use one of: ${list(taskStatuses)}.`,
  `For priority use one of: ${list(taskPriorities)}.`,
  "Use YYYY-MM-DD for dueDate.",
  "For relatedEntity use an object with type gig, person, or general and an exact ID; general uses a null ID.",
  "For clear operations use null; only dueDate and notes can be cleared.",
].join(" ");

const taskUpdateValueSchema = z.union([
  z.string(),
  taskRelatedEntityInputSchema,
  z.null(),
]);

function operationListSchema<T extends readonly [string, ...string[]]>(
  fields: T,
  clearable: ReadonlySet<T[number]>,
  clearOnly: ReadonlySet<T[number]>,
  fieldDescription: string,
  valueDescription: string,
  valueSchema: z.ZodType = updateValueSchema,
) {
  return z.array(z.object({
    operation: z.enum(["set", "clear"])
      .describe("Use set to assign a value or clear to remove a nullable value."),
    field: z.enum(fields).describe(fieldDescription),
    value: valueSchema.describe(valueDescription),
  }).strict().superRefine((change, context) => {
    if (change.operation === "clear" && change.value !== null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Clear operations must use a null value.",
      });
    }
    if (change.operation === "clear" && !clearable.has(change.field)) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: `${change.field} cannot be cleared.`,
      });
    }
    if (change.operation === "set" && change.value === null) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Set operations require a non-null value.",
      });
    }
    if (change.operation === "set" && clearOnly.has(change.field)) {
      context.addIssue({
        code: "custom",
        path: ["field"],
        message: `${change.field} can only be cleared; set its nested fields instead.`,
      });
    }
  })).min(1).superRefine((changes, context) => {
    const paths = changes.map(change => change.field);
    for (const [index, path] of paths.entries()) {
      if (paths.indexOf(path) !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "field"],
          message: `Field ${path} may only appear once.`,
        });
      }
      if (paths.some(other => other !== path && other.startsWith(`${path}.`))) {
        context.addIssue({
          code: "custom",
          path: [index, "field"],
          message: `Cannot change ${path} and one of its nested fields together.`,
        });
      }
    }
  });
}

export const gigChangesSchema = operationListSchema(
  gigUpdateFields,
  new Set([
    "externalJobId", "nextAction", "nextAction.due", "fit.summary", "payRange",
    "payRange.minimum", "payRange.maximum", "payRange.notes", "sourceUrl",
    "location", "workArrangement", "postedDate", "businessUnitTeam",
    "recruiterSource", "bonus", "equity", "otherCompensation",
  ] satisfies typeof gigUpdateFields[number][]),
  new Set(["nextAction", "payRange"] satisfies typeof gigUpdateFields[number][]),
  gigFieldDescription,
  gigValueDescription,
);

export const personChangesSchema = operationListSchema(
  personUpdateFields,
  new Set([
    "company", "title", "linkedInProfileUrl", "connectedOn",
    "relationship.introducedBy", "relationship.notes",
    "outreach.lastContacted", "outreach.lastContactMethod",
    "outreach.lastContactSummary", "outreach.nextAction",
    "outreach.nextActionDue", "whyInteresting",
  ] satisfies typeof personUpdateFields[number][]),
  new Set(),
  personFieldDescription,
  personValueDescription,
);

export const meetingChangesSchema = operationListSchema(
  meetingUpdateFields,
  new Set([
    "gigId", "location", "description",
  ] satisfies typeof meetingUpdateFields[number][]),
  new Set(),
  meetingFieldDescription,
  meetingValueDescription,
);

export const taskChangesSchema = operationListSchema(
  taskUpdateFields,
  new Set([
    "dueDate", "notes",
  ] satisfies typeof taskUpdateFields[number][]),
  new Set(),
  taskFieldDescription,
  taskValueDescription,
  taskUpdateValueSchema,
);
