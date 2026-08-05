import { z } from "zod";
import { gigClearableInputFieldPaths, gigClearOnlyInputFieldPaths, gigInputFieldPaths, gigInputSchema } from "../core/gigs";
import {
  personClearableInputFieldPaths,
  personInputFieldPaths,
  personInputSchema,
} from "../core/people";
import { meetingClearableInputFieldPaths, meetingInputFieldPaths, meetingInputSchema } from "../core/meetings";
import { taskClearableInputFieldPaths, taskInputFieldPaths, taskInputSchema } from "../core/tasks";

function schemaAtPath(root:z.ZodObject, path:string):z.ZodType {
  let current:z.ZodType=root;
  for(const segment of path.split(".")) {
    while("unwrap" in current && typeof current.unwrap==="function") current=current.unwrap();
    if(!("shape" in current)) throw new Error(`No domain schema for ${path}.`);
    current=(current as z.ZodObject).shape[segment] as z.ZodType;
  }
  while(current instanceof z.ZodOptional) current=current.unwrap() as z.ZodType;
  return current;
}

function operationListSchema<T extends readonly [string, ...string[]]>(
  fields: T,
  clearable: ReadonlySet<T[number]>,
  clearOnly: ReadonlySet<T[number]>,
  domainSchema: z.ZodObject,
) {
  const schemas=Object.fromEntries(fields.map(field=>[field,schemaAtPath(domainSchema,field)])) as Record<T[number],z.ZodType>;
  const valueSchemas=fields.filter(field=>!clearOnly.has(field)).map(field=>schemas[field as T[number]]);
  const valueSchema=z.union(valueSchemas as [z.ZodType,z.ZodType,...z.ZodType[]]);
  return z.array(z.object({
    operation: z.enum(["set", "clear"])
      .describe("Use set to assign a value or clear to remove a nullable value."),
    field: z.enum(fields).describe("Exact mutable domain field path; nested fields use dot notation."),
    value: valueSchema.describe("Value validated by the selected entity-owned domain field schema."),
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
    if(change.operation==="set"&&!schemas[change.field].safeParse(change.value).success){
      context.addIssue({code:"custom",path:["value"],message:`Value is invalid for ${change.field}.`});
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
  gigInputFieldPaths,
  gigClearableInputFieldPaths,
  gigClearOnlyInputFieldPaths,
  gigInputSchema,
);

export const personChangesSchema = operationListSchema(
  personInputFieldPaths,
  personClearableInputFieldPaths,
  new Set(),
  personInputSchema,
);

export const meetingChangesSchema = operationListSchema(
  meetingInputFieldPaths,
  meetingClearableInputFieldPaths,
  new Set(),
  meetingInputSchema,
);

export const taskChangesSchema = operationListSchema(
  taskInputFieldPaths,
  taskClearableInputFieldPaths,
  new Set(),
  taskInputSchema,
);
