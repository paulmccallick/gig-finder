import { z } from "zod";

const descriptionContentFormatSchema = z.enum(["auto", "html", "plain-text"]);
const descriptionContentEncodingSchema = z.enum(["none", "html-entities"]);
const descriptionSemantics = {
  contentFormat: descriptionContentFormatSchema.default("auto"),
  contentEncoding: descriptionContentEncodingSchema.default("none"),
};
const validateDescriptionSemantics = (
  value: { contentFormat: "auto" | "html" | "plain-text"; contentEncoding: "none" | "html-entities" },
  context: z.RefinementCtx,
) => {
  if (value.contentEncoding === "html-entities" && value.contentFormat !== "html")
    context.addIssue({
      code: "custom",
      message: "HTML entity encoding requires HTML content format.",
    });
};

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

const descriptionFieldSchema = fieldSchema
  .extend(descriptionSemantics)
  .superRefine(validateDescriptionSemantics);

const requestSchema = z
  .object({
    method: z.enum(["GET", "POST"]),
    endpoint: z
      .object({
        mode: z.enum(["configured", "origin", "position"]),
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

const detailDescriptionSchema = z.object({
  response: z.enum(["json", "html"]),
  request: requestSchema,
  descriptionPath: z.string().trim().min(1).max(200).optional(),
  locationPaths: z.array(z.string().trim().min(1).max(200)).default([]),
  workArrangementPaths: z.array(z.string().trim().min(1).max(200)).default([]),
  extractor: z.discriminatedUnion("type", [
    z.object({ type: z.literal("dom"), selector: z.string().trim().min(1).max(300), titleSelector:z.string().trim().min(1).max(300).optional(), idSelector:z.string().trim().min(1).max(300).optional() }).strict().superRefine((value,context)=>{if(!value.titleSelector&&!value.idSelector)context.addIssue({code:"custom",message:"DOM detail extraction requires an ID or title selector."});}),
    z.object({ type: z.literal("json-ld") }).strict(),
  ]).optional(),
  identity: z.object({ titlePath: z.string().trim().min(1).max(200).optional(), idPath: z.string().trim().min(1).max(200).optional() }).strict().optional(),
  ...descriptionSemantics,
}).strict().superRefine((value, context) => {
  validateDescriptionSemantics(value, context);
  if (value.response === "json" && !value.descriptionPath) context.addIssue({ code:"custom", message:"JSON detail descriptions require descriptionPath." });
  if (value.response === "json" && !value.identity?.idPath && !value.identity?.titlePath) context.addIssue({ code:"custom", message:"JSON detail descriptions require an ID or title identity path." });
  if (value.response === "html" && !value.extractor) context.addIssue({ code:"custom", message:"HTML detail descriptions require an extractor." });
});

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
    detailDescription: detailDescriptionSchema.optional(),
    fields: z
      .object({
        id: fieldSchema.optional(),
        title: fieldSchema,
        url: fieldSchema,
        location: fieldSchema.optional(),
        locations: fieldSchema.optional(),
        workArrangement: fieldSchema.optional(),
        description: descriptionFieldSchema.optional(),
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
