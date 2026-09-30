import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { JSON_SCHEMA_DRAFT_2020_12 } from "../src/convert.js";
import { fixDialect } from "../src/fix-dialect.js";

const open: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  while (open.length > 0) {
    const next = open.pop();
    await next?.close().catch(() => undefined);
  }
});

describe("SDK v1 server", () => {
  it("listTools emits draft-07 tuples and fixDialect migrates them", async () => {
    const server = new McpServer({ name: "t", version: "1" });
    server.registerTool(
      "add",
      {
        description: "add",
        inputSchema: { a: z.number(), b: z.number() },
        outputSchema: { sum: z.number(), pair: z.tuple([z.string(), z.number()]) },
      },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
        structuredContent: { sum: a + b, pair: ["x", 1] },
      }),
    );
    server.registerTool(
      "ping",
      { description: "ping", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text", text }] }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const plain = new Client({ name: "c", version: "1" });
    await plain.connect(clientTransport);
    open.push(plain, server);
    const raw = (await plain.listTools()).tools.find((tool) => tool.name === "add");
    expect(raw?.outputSchema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: {
        pair: { items: [{ type: "string" }, { type: "number" }], additionalItems: false },
      },
    });
    await plain.close();
    await server.close();

    const fixedServer = new McpServer({ name: "t", version: "1" });
    fixedServer.registerTool(
      "add",
      {
        description: "add",
        inputSchema: { a: z.number(), b: z.number() },
        outputSchema: { sum: z.number(), pair: z.tuple([z.string(), z.number()]) },
      },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
        structuredContent: { sum: a + b, pair: ["x", 1] },
      }),
    );
    fixedServer.registerTool(
      "ping",
      { description: "ping", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text", text }] }),
    );
    const [clientTransport2, serverTransport2] = InMemoryTransport.createLinkedPair();
    await fixedServer.connect(fixDialect(serverTransport2));
    const client = new Client({ name: "c", version: "1" });
    await client.connect(clientTransport2);
    open.push(client, fixedServer);

    const tools = await client.listTools();
    const add = tools.tools.find((tool) => tool.name === "add");
    expect(add?.inputSchema).toMatchObject({ $schema: JSON_SCHEMA_DRAFT_2020_12 });
    expect(add?.outputSchema).toMatchObject({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      properties: {
        pair: {
          prefixItems: [{ type: "string" }, { type: "number" }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      },
    });
    expect(add?.outputSchema).not.toHaveProperty("definitions");
    const pair = (add?.outputSchema as { properties?: { pair?: unknown } } | undefined)?.properties?.pair;
    expect(pair).not.toHaveProperty("additionalItems");
    expect(pair).not.toHaveProperty("items", expect.arrayContaining([expect.anything()]));

    const ajv = new Ajv2020({ logger: false });
    expect(add?.inputSchema).toBeDefined();
    expect(add?.outputSchema).toBeDefined();
    expect(() => ajv.compile(structuredClone(add?.inputSchema) as object)).not.toThrow();
    expect(() => ajv.compile(structuredClone(add?.outputSchema) as object)).not.toThrow();

    const ping = await client.callTool({ name: "ping", arguments: { text: "hi" } });
    expect(ping.content).toEqual([{ type: "text", text: "hi" }]);
  });
});
