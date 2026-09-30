import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_DRAFT_2020_12 } from "../src/convert.js";
import { fixDialect, type McpTransport } from "../src/fix-dialect.js";
import type { JsonRpcMessage } from "../src/jsonrpc.js";

function fakeTransport(): McpTransport & {
  sent: JsonRpcMessage[];
  emit: (message: JsonRpcMessage) => void;
} {
  const sent: JsonRpcMessage[] = [];
  let onmessage: McpTransport["onmessage"];
  const transport: McpTransport = {
    async start() {},
    async close() {},
    async send(message) {
      sent.push(message);
    },
  };
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    get: () => onmessage,
    set: (value: McpTransport["onmessage"]) => {
      onmessage = value;
    },
  });
  return Object.assign(transport, {
    sent,
    emit(message: JsonRpcMessage) {
      onmessage?.(message);
    },
  });
}

describe("fixDialect", () => {
  it("converts tools/list responses and leaves other traffic alone", async () => {
    const inner = fakeTransport();
    const wrapped = fixDialect(inner);
    const seen: JsonRpcMessage[] = [];
    wrapped.onmessage = (message) => {
      seen.push(message);
    };

    inner.emit({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    inner.emit({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "add" } });

    const draft = {
      name: "add",
      inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { a: { type: "number" } },
      },
      outputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "array",
        items: [{ type: "string" }],
        additionalItems: false,
      },
      title: "Add",
    };

    await wrapped.send({
      jsonrpc: "2.0",
      id: 5,
      result: { content: [{ type: "text", text: "ok" }], tools: [structuredClone(draft)] },
    });
    await wrapped.send({
      jsonrpc: "2.0",
      id: 4,
      result: { tools: [draft] },
    });

    expect(seen.map((message) => message.method)).toEqual(["tools/list", "tools/call"]);
    const callResponse = inner.sent[0];
    expect(callResponse).toMatchObject({
      id: 5,
      result: { tools: [draft] },
    });
    const listResponse = inner.sent[1]?.result as { tools: Array<Record<string, unknown>> };
    expect(listResponse.tools[0]).toMatchObject({
      title: "Add",
      inputSchema: { $schema: JSON_SCHEMA_DRAFT_2020_12, type: "object" },
      outputSchema: {
        $schema: JSON_SCHEMA_DRAFT_2020_12,
        prefixItems: [{ type: "string" }],
        items: false,
      },
    });
    expect(listResponse.tools[0]?.outputSchema).not.toHaveProperty("additionalItems");
  });

  it("forwards lifecycle hooks", async () => {
    let started = false;
    let closed = false;
    let version = "";
    const inner: McpTransport = {
      sessionId: "session-1",
      async start() {
        started = true;
      },
      async close() {
        closed = true;
        this.onclose?.();
      },
      async send() {},
      setProtocolVersion(next) {
        version = next;
      },
    };
    const wrapped = fixDialect(inner);
    let closedSeen = false;
    wrapped.onclose = () => {
      closedSeen = true;
    };
    expect(wrapped.sessionId).toBe("session-1");
    wrapped.sessionId = "session-2";
    expect(inner.sessionId).toBe("session-2");
    await wrapped.start();
    wrapped.setProtocolVersion?.("2025-03-26");
    await wrapped.close();
    expect(started).toBe(true);
    expect(closed).toBe(true);
    expect(closedSeen).toBe(true);
    expect(version).toBe("2025-03-26");
  });
});
