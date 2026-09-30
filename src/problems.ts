import { Ajv2020 } from "ajv/dist/2020.js";
import { escapePointer, isPlainObject, type JsonObject } from "./object.js";

const ACCEPTED_DIALECTS = new Set([
  "https://json-schema.org/draft/2020-12/schema",
  "https://json-schema.org/draft/2020-12/schema#",
]);

const SCHEMA_MAP_KEYS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
] as const;

const SCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

const SCHEMA_VALUE_KEYS = [
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
  "contentSchema",
  "items",
  "additionalItems",
] as const;

/**
 * Reasons `schema` is not JSON Schema 2020-12 as written.
 *
 * A schema fails when any subschema (schema keywords only — not `enum`,
 * `const`, `default`, or `examples`) has a non-2020-12 `$schema`, array
 * `items`, `additionalItems`, `definitions`, or `dependencies`, or when the
 * document does not compile under Ajv 2020. Format annotations are ignored
 * so values such as `email` are not reported as dialect errors. Ajv's own
 * tuple hints are silenced; they do not fail compilation.
 */
export function findDialectProblems(schema: unknown): string[] {
  const problems: string[] = [];
  if (typeof schema !== "boolean" && !isPlainObject(schema)) {
    return ["schema is not a JSON Schema object or boolean"];
  }

  collectStructural(schema, "", problems);
  const compileError = strictCompileError(schema);
  if (compileError) problems.push(compileError);
  return problems;
}

function collectStructural(schema: unknown, path: string, problems: string[]): void {
  if (typeof schema === "boolean" || !isPlainObject(schema)) return;

  if (Object.hasOwn(schema, "$schema") && !ACCEPTED_DIALECTS.has(String(schema.$schema))) {
    problems.push(`$schema is ${shown(schema.$schema)}${at(path)}`);
  }
  if (Array.isArray(schema.items)) {
    problems.push(`items is an array${at(path)}`);
  }
  if (Object.hasOwn(schema, "additionalItems")) {
    problems.push(`additionalItems is present${at(path)}`);
  }
  if (Object.hasOwn(schema, "definitions")) {
    problems.push(`definitions is present${at(path)}`);
  }
  if (Object.hasOwn(schema, "dependencies")) {
    problems.push(`dependencies is present${at(path)}`);
  }

  for (const key of SCHEMA_MAP_KEYS) {
    const value = schema[key];
    if (!isPlainObject(value)) continue;
    for (const [name, child] of Object.entries(value)) {
      collectStructural(child, `${path}/${key}/${escapePointer(name)}`, problems);
    }
  }

  for (const key of SCHEMA_ARRAY_KEYS) {
    const value = schema[key];
    if (!Array.isArray(value)) continue;
    value.forEach((child, index) => {
      collectStructural(child, `${path}/${key}/${index}`, problems);
    });
  }

  for (const key of SCHEMA_VALUE_KEYS) {
    if (!Object.hasOwn(schema, key)) continue;
    const value = schema[key];
    if (key === "items" && Array.isArray(value)) {
      value.forEach((child, index) => {
        collectStructural(child, `${path}/items/${index}`, problems);
      });
      continue;
    }
    if (typeof value === "boolean" || isPlainObject(value)) {
      collectStructural(value, `${path}/${key}`, problems);
    }
  }

  if (isPlainObject(schema.dependencies)) {
    for (const [name, child] of Object.entries(schema.dependencies)) {
      if (typeof child === "boolean" || isPlainObject(child)) {
        collectStructural(child, `${path}/dependencies/${escapePointer(name)}`, problems);
      }
    }
  }
}

function strictCompileError(schema: boolean | JsonObject): string | undefined {
  try {
    const ajv = new Ajv2020({ validateFormats: false, logger: false });
    ajv.compile(typeof schema === "boolean" ? schema : structuredClone(schema));
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const line = message.split("\n")[0]?.trim() || message.trim();
    const clipped = line.length > 240 ? `${line.slice(0, 237)}...` : line;
    return `strict Ajv 2020: ${clipped}`;
  }
}

function at(path: string): string {
  return path ? ` at ${path}` : "";
}

function shown(value: unknown): string {
  if (typeof value === "string") return value;
  return typeof value;
}
