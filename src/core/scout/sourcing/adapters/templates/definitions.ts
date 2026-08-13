import { z } from "zod";

const templateInputNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*$/);

const fieldSchema = z
  .object({
    paths: z.array(z.string().min(1)).min(1),
    separator: z.string().optional(),
    template: z.string().optional(),
    fallbackPaths: z.array(z.string().min(1)).default([]),
    fallbackTemplate: z.string().optional(),
    transforms: z
      .array(z.enum(["slug", "strip-job-prefix", "url-encode"]))
      .default([]),
    fallbackTransforms: z
      .array(z.enum(["slug", "strip-job-prefix", "url-encode"]))
      .default([]),
    find: z
      .object({
        path: z.string().min(1),
        wherePath: z.string().min(1),
        equals: z.string(),
        valuePath: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

const requestSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    endpoint: z
      .object({
        mode: z.enum(["configured", "origin"]),
        path: z.string().optional(),
        canonicalHost: z.string().optional(),
        configuredPathIncludes: z.string().optional(),
        publicUrlTemplate: z.string().optional(),
        publicPath: z.string().optional(),
        clearQuery: z.boolean().default(false),
        removeQuery: z.array(z.string()).default([]),
      })
      .strict(),
    query: z.record(z.string(), z.string()).default({}),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const inputSchema = z
  .object({
    name: templateInputNameSchema,
    required: z.boolean().default(false),
  })
  .strict();

export const reusableJsonDefinitionSchema = z
  .object({
    kind: z.literal("hr-system"),
    version: z.number().int().positive(),
    id: templateInputNameSchema,
    inputs: z
      .object({
        variables: z.array(inputSchema).default([]),
        overrides: z.array(inputSchema).default([]),
      })
      .strict(),
    requestHook: z.enum(["adp-session", "avature-session"]).optional(),
    recordsPaths: z.array(z.string().min(1)).min(1),
    totalPaths: z.array(z.string().min(1)).default([]),
    pageSize: z.number().int().positive(),
    exhaustion: z
      .object({ mode: z.enum(["reported-total", "single-response"]) })
      .strict(),
    payload: z
      .object({ assignment: z.string().min(1) })
      .strict()
      .optional(),
    record: z
      .object({ unwrapPaths: z.array(z.string().min(1)).min(1) })
      .strict()
      .optional(),
    request: requestSchema.optional(),
    fields: z
      .object({
        id: fieldSchema.optional(),
        title: fieldSchema,
        url: fieldSchema,
        location: fieldSchema.optional(),
        description: fieldSchema.optional(),
        descriptionUrl: fieldSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((template, context) => {
    for (const group of [template.inputs.variables, template.inputs.overrides]) {
      const names = group.map((input) => input.name);
      if (new Set(names).size !== names.length)
        context.addIssue({
          code: "custom",
          path: ["inputs"],
          message: "Template input names must be unique.",
        });
    }
    if (!template.request && !template.requestHook)
      context.addIssue({
        code: "custom",
        path: ["request"],
        message: "A template requires request configuration or a request hook.",
      });
  });

export type ReusableJsonDefinition = z.infer<
  typeof reusableJsonDefinitionSchema
>;

export interface TemplateResolver {
  resolve(reference: {
    id: string;
    version: number;
  }): ReusableJsonDefinition;
}

export function createTemplateCatalog(artifacts: unknown[]): TemplateResolver {
  const templates = new Map<string, ReusableJsonDefinition>();
  for (const artifact of artifacts) {
    const template = reusableJsonDefinitionSchema.parse(artifact);
    const key = `${template.id}@${template.version}`;
    if (templates.has(key)) throw new Error(`duplicate_scout_template:${key}`);
    templates.set(key, template);
  }
  return {
    resolve(reference) {
      const template = templates.get(`${reference.id}@${reference.version}`);
      if (!template)
        throw new Error(
          `unknown_scout_template:${reference.id}@${reference.version}`,
        );
      return template;
    },
  };
}

export function validateTemplateSourceInputs(
  reference: {
  id: string;
  version: number;
  },
  variables: Record<string, string>,
  overrides: Record<string, string>,
  resolver: TemplateResolver,
) {
  const template = resolver.resolve(reference);
  const allowedVariables = new Map(
    template.inputs.variables.map((input) => [input.name, input]),
  );
  const allowedOverrides = new Set(
    template.inputs.overrides.map((input) => input.name),
  );
  for (const key of Object.keys(variables))
    if (!allowedVariables.has(key))
      throw new Error(`${template.id}_variable_not_allowed:${key}`);
  for (const input of allowedVariables.values())
    if (input.required && !variables[input.name])
      throw new Error(`${template.id}_variable_required:${input.name}`);
  for (const key of Object.keys(overrides))
    if (!allowedOverrides.has(key))
      throw new Error(`${template.id}_override_not_allowed:${key}`);
  return template;
}
