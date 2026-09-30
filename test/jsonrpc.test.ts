import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_DRAFT_2020_12 } from "../src/convert.js";
import { createPendingIds, noteToolsListRequest, rewriteToolsListResponse } from "../src/jsonrpc.js";

const draftTool = {
  name: "add",
  description: "add",
  inputSchema: {
    type: "object",
    properties: { a: { type: "number" } },
    $schema: "http://json-schema.org/draft-07/schema#",
  },
  outputSchema: {
    type: "object",
    properties: {
      pair: {
        type: "array",
        items: [{ type: "string" }, { type: "number" }],
        additionalItems: false,
      },
    },
    definitions: {
      Name: { type: "string" },
    },
    $schema: "http://json-schema.org/draft-07/schema#",
  },
  execution: { taskSupport: "forbidden" },
};

describe("tools/list correlation", () => {
  it("rewrites only the response whose id was a tools/list request", () => {
    const pending = createPendingIds();
    noteToolsListRequest({ jsonrpc: "2.0", id: 7, method: "tools/list" }, pending);
    noteToolsListRequest({ jsonrpc: "2.0", id: "other", method: "tools/call" }, pending);

    const unrelated = {
      jsonrpc: "2.0",
      id: 7,
      result: { tools: [draftTool] },
    };
    // Number 7 is pending, so this one is rewritten. A same-shaped response
    // with a different id is not.
    const rewritten = rewriteToolsListResponse(unrelated, pending);
    expect(rewritten).not.toBe(unrelated);
    const tool = (rewritten.result as { tools: Array<Record<string, unknown>> }).tools[0];
    expect(tool?.execution).toEqual({ taskSupport: "forbidden" });
    expect(tool?.inputSchema).toMatchObject({ $schema: JSON_SCHEMA_DRAFT_2020_12 });
    expect(tool?.outputSchema).toMatchObject({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      properties: {
        pair: {
          prefixItems: [{ type: "string" }, { type: "number" }],
          items: false,
        },
      },
      $defs: { Name: { type: "string" } },
    });
    expect(tool?.outputSchema).not.toHaveProperty("definitions");

    const shaped = {
      jsonrpc: "2.0",
      id: 8,
      result: { tools: [structuredClone(draftTool)] },
    };
    expect(rewriteToolsListResponse(shaped, pending)).toBe(shaped);

    const stringId = {
      jsonrpc: "2.0",
      id: "7",
      result: { tools: [structuredClone(draftTool)] },
    };
    expect(rewriteToolsListResponse(stringId, pending)).toBe(stringId);
  });

  it("does not rewrite an error response, and does not reuse the id", () => {
    const pending = createPendingIds();
    noteToolsListRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, pending);
    const error = { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "nope" } };
    expect(rewriteToolsListResponse(error, pending)).toBe(error);
    const late = { jsonrpc: "2.0", id: 1, result: { tools: [structuredClone(draftTool)] } };
    expect(rewriteToolsListResponse(late, pending)).toBe(late);
  });

  it("tracks a later tools/list id after the first response", () => {
    const pending = createPendingIds();
    noteToolsListRequest({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, pending);
    rewriteToolsListResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } }, pending);
    noteToolsListRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor: "2" } }, pending);
    const page = rewriteToolsListResponse(
      { jsonrpc: "2.0", id: 2, result: { tools: [structuredClone(draftTool)], nextCursor: undefined } },
      pending,
    );
    expect(page.result?.tools?.[0]?.inputSchema).toMatchObject({ $schema: JSON_SCHEMA_DRAFT_2020_12 });
  });
});
