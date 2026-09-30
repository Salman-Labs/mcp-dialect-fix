export interface JsonObject {
  [key: string]: unknown;
}

export function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** JSON Pointer segment encoding (`~` → `~0`, `/` → `~1`). */
export function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
