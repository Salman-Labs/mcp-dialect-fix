import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { convertSchema, JSON_SCHEMA_DRAFT_2020_12, type JsonSchema } from "../src/convert.js";

function expectCompiles(schema: JsonSchema): void {
  const ajv = new Ajv2020({ logger: false });
  expect(() => ajv.compile(structuredClone(schema))).not.toThrow();
}

function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}

describe("convertSchema", () => {
  it("turns a draft-07 tuple into prefixItems and items:false", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      additionalProperties: false,
      required: ["sum", "pair"],
      properties: {
        sum: { type: "number" },
        pair: {
          type: "array",
          items: [{ type: "string" }, { type: "number" }],
          additionalItems: false,
          minItems: 2,
          maxItems: 2,
        },
      },
    };
    const output = convertSchema(input);
    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      type: "object",
      additionalProperties: false,
      required: ["sum", "pair"],
      properties: {
        sum: { type: "number" },
        pair: {
          type: "array",
          prefixItems: [{ type: "string" }, { type: "number" }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      },
    });
    expectCompiles(output);
  });

  it("moves an additionalItems schema onto items", () => {
    const output = convertSchema({
      type: "array",
      items: [{ $ref: "#/definitions/A" }],
      additionalItems: { $ref: "#/definitions/B" },
      definitions: {
        A: { type: "string" },
        B: { type: "number" },
      },
    });
    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      type: "array",
      prefixItems: [{ $ref: "#/$defs/A" }],
      items: { $ref: "#/$defs/B" },
      $defs: {
        A: { type: "string" },
        B: { type: "number" },
      },
    });
    expectCompiles(output);
  });

  it("maps additionalItems true and drops a lone additionalItems", () => {
    expect(
      convertSchema({
        type: "array",
        items: [{ type: "string" }],
        additionalItems: true,
      }),
    ).toMatchObject({ prefixItems: [{ type: "string" }], items: true });

    const lone = convertSchema({
      type: "array",
      items: { type: "string" },
      additionalItems: false,
    });
    expect(lone).toMatchObject({ items: { type: "string" } });
    expect(lone).not.toHaveProperty("additionalItems");
    expectCompiles(lone);
  });

  it("renames definitions and rewrites nested, escaped $refs", () => {
    const output = convertSchema({
      $schema: "http://json-schema.org/draft-04/schema#",
      type: "object",
      properties: {
        a: { $ref: "#/definitions/Name" },
        b: { $ref: "#/definitions/Wrap/properties/inner" },
        d: { $ref: "#/definitions/a~1b~0c" },
      },
      definitions: {
        Name: { type: "string" },
        Wrap: {
          type: "object",
          properties: {
            inner: { $ref: "#/definitions/Name" },
          },
        },
        "a/b~c": { type: "number" },
      },
    });
    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      type: "object",
      properties: {
        a: { $ref: "#/$defs/Name" },
        b: { $ref: "#/$defs/Wrap/properties/inner" },
        d: { $ref: "#/$defs/a~1b~0c" },
      },
      $defs: {
        Name: { type: "string" },
        Wrap: {
          type: "object",
          properties: {
            inner: { $ref: "#/$defs/Name" },
          },
        },
        "a/b~c": { type: "number" },
      },
    });
    expectCompiles(output);
    expect(convertSchema({ $ref: "#/definitions" })).toMatchObject({ $ref: "#/$defs" });
  });

  it("leaves external and unrelated refs alone", () => {
    const output = convertSchema({
      properties: {
        a: { $ref: "https://example.com/schema.json#/definitions/Foo" },
        b: { $ref: "#/properties/definitions" },
      },
    });
    expect(output).toMatchObject({
      properties: {
        a: { $ref: "https://example.com/schema.json#/definitions/Foo" },
        b: { $ref: "#/properties/definitions" },
      },
    });
  });

  it("puts $schema only on the root", () => {
    const output = convertSchema({
      properties: {
        a: { $schema: "http://json-schema.org/draft-07/schema#", type: "string" },
      },
    });
    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      properties: { a: { type: "string" } },
    });
    expectCompiles(output);
  });

  it("normalizes an existing 2020-12 dialect id", () => {
    const output = convertSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema#",
      type: "array",
      prefixItems: [{ type: "string" }],
      items: false,
    });
    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      type: "array",
      prefixItems: [{ type: "string" }],
      items: false,
    });
    expectCompiles(output);
  });

  it("rewrites nested subschemas and splits dependencies", () => {
    const output = convertSchema({
      type: "object",
      properties: {
        nested: {
          allOf: [{ not: { type: "null" } }],
          anyOf: [{ oneOf: [{ type: "string" }] }],
          if: { type: "object" },
          then: { required: ["a"] },
          else: { type: "array", items: [{ type: "number" }], additionalItems: { type: "string" } },
        },
      },
      patternProperties: {
        "^x": { contains: { type: "string" }, propertyNames: { type: "string" } },
      },
      additionalProperties: {
        type: "array",
        items: [{ type: "boolean" }],
        additionalItems: false,
      },
      dependencies: {
        credit_card: ["billing_address"],
        name: {
          properties: {
            name: { minLength: 1 },
          },
        },
        flag: true,
      },
    });

    expect(output).toEqual({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      type: "object",
      properties: {
        nested: {
          allOf: [{ not: { type: "null" } }],
          anyOf: [{ oneOf: [{ type: "string" }] }],
          if: { type: "object" },
          then: { required: ["a"] },
          else: {
            type: "array",
            prefixItems: [{ type: "number" }],
            items: { type: "string" },
          },
        },
      },
      patternProperties: {
        "^x": { contains: { type: "string" }, propertyNames: { type: "string" } },
      },
      additionalProperties: {
        type: "array",
        prefixItems: [{ type: "boolean" }],
        items: false,
      },
      dependentRequired: {
        credit_card: ["billing_address"],
      },
      dependentSchemas: {
        name: { properties: { name: { minLength: 1 } } },
        flag: true,
      },
    });
    expect(output).not.toHaveProperty("dependencies");
    expectCompiles(output);
  });

  it("keeps existing $defs and dependentRequired keys", () => {
    const output = convertSchema({
      definitions: { A: { type: "string" }, B: { type: "number" } },
      $defs: { B: { type: "integer" } },
      dependencies: { a: ["from-dependencies"], c: ["added"] },
      dependentRequired: { a: ["keep"] },
    });
    expect(output).toMatchObject({
      $defs: { A: { type: "string" }, B: { type: "integer" } },
      dependentRequired: { a: ["keep"], c: ["added"] },
    });
    expect(output).not.toHaveProperty("definitions");
    expect(output).not.toHaveProperty("dependencies");
    expectCompiles(output);
  });

  it("does not treat examples, const, enum, or default as subschemas", () => {
    const input = {
      type: "string",
      examples: [{ items: ["not", "a", "schema"], additionalItems: false, definitions: { A: 1 } }],
      const: { items: [{ type: "string" }], definitions: {} },
      enum: [{ additionalItems: false }],
      default: { $ref: "#/definitions/Nope" },
    };
    const output = convertSchema(input);
    expect(output).toEqual({ ...input, $schema: JSON_SCHEMA_DRAFT_2020_12 });
    expectCompiles(output);
  });

  it("is idempotent and does not mutate the input", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        pair: {
          type: "array",
          items: [{ $ref: "#/definitions/Name" }, { type: "number" }],
          additionalItems: false,
        },
      },
      definitions: { Name: { type: "string" } },
      dependencies: { pair: ["other"] },
    };
    freeze(input);
    const once = convertSchema(input);
    const twice = convertSchema(once);
    expect(twice).toEqual(once);
    expect(once).not.toBe(input);
    expect(input).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        pair: {
          type: "array",
          items: [{ $ref: "#/definitions/Name" }, { type: "number" }],
          additionalItems: false,
        },
      },
      definitions: { Name: { type: "string" } },
      dependencies: { pair: ["other"] },
    });
    expectCompiles(once);
  });

  it("returns boolean schemas unchanged", () => {
    expect(convertSchema(true)).toBe(true);
    expect(convertSchema(false)).toBe(false);
    expect(convertSchema(convertSchema(true))).toBe(true);
  });

  it("rejects values that are not schemas", () => {
    expect(() => convertSchema(null as never)).toThrow(TypeError);
    expect(() => convertSchema([] as never)).toThrow(TypeError);
    expect(() => convertSchema("object" as never)).toThrow(TypeError);
  });
});
