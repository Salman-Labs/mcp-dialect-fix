import { isPlainObject, isStringArray, type JsonObject } from "./object.js";

/** Canonical JSON Schema 2020-12 dialect URI. Only the root schema carries it. */
export const JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

export type JsonSchemaObject = JsonObject;
export type JsonSchema = boolean | JsonSchemaObject;

const DEFINITIONS_REF = "#/definitions";

const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "dependentSchemas"] as const;

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
] as const;

/**
 * Return a JSON Schema 2020-12 document with the same meaning as `schema`.
 * The input is not mutated. Boolean schemas are returned unchanged.
 */
export function convertSchema(schema: JsonSchema): JsonSchema {
  if (typeof schema === "boolean") {
    return schema;
  }
  if (!isPlainObject(schema)) {
    throw new TypeError("convertSchema expected a JSON Schema object or boolean");
  }
  return convertNode(structuredClone(schema), true);
}

function convertNode(node: unknown, isRoot: boolean): JsonSchema {
  if (typeof node === "boolean") {
    return node;
  }
  if (!isPlainObject(node)) {
    return node as JsonSchema;
  }

  if (isRoot) {
    node.$schema = JSON_SCHEMA_DRAFT_2020_12;
  } else {
    delete node.$schema;
  }

  if (typeof node.$ref === "string") {
    node.$ref = rewriteDefinitionsRef(node.$ref);
  }

  hoistDefinitions(node);
  rewriteTupleItems(node);
  splitDependencies(node);

  for (const key of SCHEMA_MAP_KEYS) {
    const value = node[key];
    if (!isPlainObject(value)) continue;
    for (const name of Object.keys(value)) {
      value[name] = convertNode(value[name], false);
    }
  }

  for (const key of SCHEMA_ARRAY_KEYS) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    node[key] = value.map((item) => convertNode(item, false));
  }

  for (const key of SCHEMA_VALUE_KEYS) {
    if (!Object.hasOwn(node, key)) continue;
    const value = node[key];
    if (typeof value === "boolean" || isPlainObject(value)) {
      node[key] = convertNode(value, false);
    }
  }

  return node;
}

function rewriteDefinitionsRef(ref: string): string {
  if (ref === DEFINITIONS_REF || ref.startsWith(`${DEFINITIONS_REF}/`)) {
    return `#/$defs${ref.slice(DEFINITIONS_REF.length)}`;
  }
  return ref;
}

function hoistDefinitions(node: JsonObject): void {
  if (!isPlainObject(node.definitions)) return;
  const defs: JsonObject = isPlainObject(node.$defs) ? node.$defs : {};
  for (const [key, value] of Object.entries(node.definitions)) {
    if (!Object.hasOwn(defs, key)) {
      defs[key] = value;
    }
  }
  node.$defs = defs;
  delete node.definitions;
}

/**
 * Draft-04/06/07 tuple form (`items` as an array, plus `additionalItems`)
 * becomes 2020-12 `prefixItems` and `items`. `additionalItems` beside a
 * non-array `items` does not apply in those drafts, so it is dropped.
 */
function rewriteTupleItems(node: JsonObject): void {
  if (!Array.isArray(node.items)) {
    if (Object.hasOwn(node, "additionalItems")) {
      delete node.additionalItems;
    }
    return;
  }

  if (!Array.isArray(node.prefixItems)) {
    node.prefixItems = node.items;
  }

  if (Object.hasOwn(node, "additionalItems")) {
    node.items = node.additionalItems;
    delete node.additionalItems;
  } else {
    delete node.items;
  }
}

function splitDependencies(node: JsonObject): void {
  if (!isPlainObject(node.dependencies)) return;

  const required: JsonObject = isPlainObject(node.dependentRequired) ? node.dependentRequired : {};
  const schemas: JsonObject = isPlainObject(node.dependentSchemas) ? node.dependentSchemas : {};
  let sawRequired = isPlainObject(node.dependentRequired);
  let sawSchemas = isPlainObject(node.dependentSchemas);

  for (const [key, value] of Object.entries(node.dependencies)) {
    if (isStringArray(value)) {
      if (!Object.hasOwn(required, key)) required[key] = value;
      sawRequired = true;
    } else if (typeof value === "boolean" || isPlainObject(value)) {
      if (!Object.hasOwn(schemas, key)) schemas[key] = value;
      sawSchemas = true;
    }
  }

  if (sawRequired) node.dependentRequired = required;
  if (sawSchemas) node.dependentSchemas = schemas;
  delete node.dependencies;
}
