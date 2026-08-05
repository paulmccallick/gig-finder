import { describe, expect, test } from "bun:test";
import {
  StrictToolSchemaError,
  validateStrictToolJsonSchema,
} from "../strict-tool-schema";

describe("strict tool schema validation", () => {
  test("traverses arrays, combinators, nullable branches, definitions, and refs", () => {
    const leaf = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    };
    expect(() => validateStrictToolJsonSchema("complete_tool", {
      type: "object",
      properties: {
        entries: { type: "array", items: { $ref: "#/$defs/leaf" } },
        choice: { anyOf: [leaf, { type: "null" }] },
        variant: { oneOf: [leaf] },
        composed: { allOf: [leaf] },
      },
      required: ["entries", "choice", "variant", "composed"],
      additionalProperties: false,
      $defs: { leaf },
    })).not.toThrow();
  });

  test("accepts recursive root references emitted by Zod", () => {
    expect(() => validateStrictToolJsonSchema("recursive_tool", {
      type: "object",
      properties: {
        children: { type: "array", items: { $ref: "#" } },
      },
      required: ["children"],
      additionalProperties: false,
    })).not.toThrow();
  });

  test("reports a bounded tool and path without leaking schema content", () => {
    const privateValue = "PRIVATE_PROMPT_CONTENT_SHOULD_NOT_APPEAR";
    let error: unknown;
    try {
      validateStrictToolJsonSchema("unsafe_tool", {
        type: "object",
        properties: {
          nested: {
            type: "object",
            description: privateValue,
            properties: { secret: { type: "string", description: privateValue } },
            required: [],
            additionalProperties: true,
          },
        },
        required: ["nested"],
        additionalProperties: false,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(StrictToolSchemaError);
    expect((error as Error).message).toContain("unsafe_tool");
    expect((error as Error).message).toContain("$.properties.nested");
    expect((error as Error).message).not.toContain(privateValue);
    expect((error as Error).message.length).toBeLessThan(200);
  });
});
