export interface StrictSchemaIssue {
  toolName: string;
  path: string;
  reason: string;
}

export class StrictToolSchemaError extends Error {
  constructor(readonly issue: StrictSchemaIssue) {
    super(`Invalid strict tool schema for ${issue.toolName} at ${issue.path}: ${issue.reason}`);
    this.name = "StrictToolSchemaError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pointer = (root: unknown, reference: string): unknown => {
  if (reference === "#") return root;
  if (!reference.startsWith("#/")) return undefined;
  return reference.slice(2).split("/").reduce<unknown>((value, part) => (
    record(value) ? value[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined
  ), root);
};

/** Validates every object reachable in one emitted tool JSON Schema. */
export function validateStrictToolJsonSchema(toolName: string, schema: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (node: unknown, path: string, refStack: Set<string>): void => {
    if (!record(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (typeof node.$ref === "string") {
      if (refStack.has(node.$ref)) return;
      const target = pointer(schema, node.$ref);
      if (target === undefined) {
        throw new StrictToolSchemaError({
          toolName,
          path: `${path}.$ref`,
          reason: "local reference does not resolve",
        });
      }
      visit(target, `${path}.$ref`, new Set([...refStack, node.$ref]));
    }
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (types.includes("object") || record(node.properties)) {
      const properties = record(node.properties) ? Object.keys(node.properties) : [];
      if (node.additionalProperties !== false) {
        throw new StrictToolSchemaError({
          toolName,
          path,
          reason: "additionalProperties must be false",
        });
      }
      if (!Array.isArray(node.required) || node.required.some(value => typeof value !== "string")) {
        throw new StrictToolSchemaError({
          toolName,
          path,
          reason: "required must list every property",
        });
      }
      const required = node.required as string[];
      if (required.length !== new Set(required).size
        || properties.some(key => !required.includes(key))
        || required.some(key => !properties.includes(key))) {
        throw new StrictToolSchemaError({
          toolName,
          path,
          reason: "required must exactly match declared properties",
        });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref") continue;
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}.${key}[${index}]`, refStack));
      } else {
        visit(value, `${path}.${key}`, refStack);
      }
    }
  };
  visit(schema, "$", new Set());
}
