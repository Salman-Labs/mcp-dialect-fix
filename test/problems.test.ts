import { describe, expect, it } from "vitest";
import { convertSchema } from "../src/convert.js";
import { findDialectProblems } from "../src/problems.js";

describe("findDialectProblems", () => {
  it("flags draft-07 tuples, definitions, and dependencies", () => {
    const problems = findDialectProblems({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        pair: {
          type: "array",
          items: [{ type: "string" }],
          additionalItems: false,
        },
      },
      definitions: { Id: { type: "string" } },
      dependencies: { pair: ["id"] },
    });
    expect(problems).toEqual([
      "$schema is http://json-schema.org/draft-07/schema#",
      "definitions is present",
      "dependencies is present",
      "items is an array at /properties/pair",
      "additionalItems is present at /properties/pair",
      'strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"',
    ]);
  });

  it("accepts a converted schema, including format annotations", () => {
    const schema = convertSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        pair: {
          type: "array",
          items: [{ type: "string" }, { type: "number" }],
          additionalItems: false,
          minItems: 2,
          maxItems: 2,
        },
      },
      definitions: { Id: { type: "string" } },
      dependencies: { email: ["pair"] },
    });
    expect(findDialectProblems(schema)).toEqual([]);
  });

  it("accepts boolean schemas and the hash form of the 2020-12 dialect", () => {
    expect(findDialectProblems(false)).toEqual([]);
    expect(
      findDialectProblems({
        $schema: "https://json-schema.org/draft/2020-12/schema#",
        type: "number",
      }),
    ).toEqual([]);
  });

  it("rejects values that are not schemas", () => {
    expect(findDialectProblems(null)).toEqual(["schema is not a JSON Schema object or boolean"]);
  });
});
