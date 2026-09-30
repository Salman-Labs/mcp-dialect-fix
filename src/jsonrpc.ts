import { convertSchema, type JsonSchema } from "./convert.js";
import { isPlainObject, type JsonObject } from "./object.js";

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export function idKey(id: unknown): string | undefined {
  if (typeof id === "string") return `s:${id}`;
  if (typeof id === "number" && Number.isFinite(id)) return `n:${id}`;
  return undefined;
}

export function noteToolsListRequest(message: unknown, pending: Set<string>): void {
  if (!isPlainObject(message)) return;
  if (message.method !== "tools/list") return;
  if (!Object.hasOwn(message, "id")) return;
  if (Object.hasOwn(message, "result") || Object.hasOwn(message, "error")) return;
  const key = idKey(message.id);
  if (key) pending.add(key);
}

/**
 * If `message` is the response to a `tools/list` request recorded in
 * `pending`, return a copy whose tool schemas are JSON Schema 2020-12.
 * Otherwise return the same reference.
 */
export function rewriteToolsListResponse<T>(message: T, pending: Set<string>): T {
  if (!isPlainObject(message)) return message;
  if (typeof message.method === "string") return message;
  if (!Object.hasOwn(message, "id")) return message;
  const key = idKey(message.id);
  if (!key || !pending.has(key)) return message;
  pending.delete(key);
  if (message.error !== undefined) return message;
  if (!isPlainObject(message.result) || !Array.isArray(message.result.tools)) return message;

  const tools = message.result.tools.map((tool) => rewriteTool(tool));
  return {
    ...message,
    result: { ...message.result, tools },
  } as T;
}

function rewriteTool(tool: unknown): unknown {
  if (!isPlainObject(tool)) return tool;
  let changed = false;
  const next: JsonObject = { ...tool };
  for (const slot of ["inputSchema", "outputSchema"] as const) {
    const schema = next[slot];
    if (typeof schema === "boolean" || isPlainObject(schema)) {
      next[slot] = convertSchema(schema as JsonSchema);
      changed = true;
    }
  }
  return changed ? next : tool;
}

export function parseJsonLine(line: string): unknown {
  const text = (line.endsWith("\r") ? line.slice(0, -1) : line).trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createPendingIds(): Set<string> {
  return new Set();
}
