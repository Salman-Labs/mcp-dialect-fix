import { Ajv2020 } from "ajv/dist/2020.js";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { JSON_SCHEMA_DRAFT_2020_12 } from "../src/convert.js";
import { fixturePath, readLines, runCli, spawnCli } from "./helpers.js";

function rpc(id: number, method: string, params?: unknown): string {
  const message: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) message.params = params;
  return `${JSON.stringify(message)}\n`;
}

describe("stdio proxy", () => {
  it("rewrites tools/list, forwards other traffic, and preserves stderr", async () => {
    const child = spawnCli(["--", process.execPath, fixturePath("draft07-server.mjs")]);
    const lines = readLines(child);
    const noise = await lines.next();
    expect(noise).toBe("not-json leftover");

    child.stdin.write(rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } }));
    const initialized = await lines.next();
    expect(initialized).toBe(
      '{"jsonrpc":"2.0", "id":1, "result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"draft07-fixture","version":"0.0.0"}}}',
    );
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    child.stdin.write(rpc(2, "tools/list"));
    const page1 = JSON.parse(await lines.next()) as {
      id: number;
      result: { tools: Array<Record<string, unknown>>; nextCursor?: string };
    };
    expect(page1.result.nextCursor).toBe("2");
    const echo = page1.result.tools[0];
    expect(echo?.name).toBe("echo");
    expect(echo?.outputSchema).toMatchObject({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      properties: {
        pair: {
          prefixItems: [{ type: "string" }, { type: "number" }],
          items: false,
        },
      },
    });
    const ajv = new Ajv2020({ logger: false });
    expect(() => ajv.compile(structuredClone(echo?.inputSchema) as object)).not.toThrow();
    expect(() => ajv.compile(structuredClone(echo?.outputSchema) as object)).not.toThrow();

    child.stdin.write(rpc(3, "tools/list", { cursor: "2" }));
    const page2 = JSON.parse(await lines.next()) as { result: { tools: Array<Record<string, unknown>> } };
    const lookup = page2.result.tools[0];
    expect(lookup?.name).toBe("lookup");
    expect(lookup?.inputSchema).toMatchObject({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      properties: { id: { $ref: "#/$defs/Id" } },
      $defs: { Id: { type: "string" } },
    });
    expect(lookup?.inputSchema).not.toHaveProperty("definitions");
    expect(() => ajv.compile(structuredClone(lookup?.inputSchema) as object)).not.toThrow();

    child.stdin.write(rpc(4, "tools/call", { name: "echo", arguments: { text: "hi" } }));
    const call = await lines.next();
    expect(call).toBe('{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"called:echo:hi"}],"untouched":true}}');

    child.stdin.write(rpc(5, "emit-shaped"));
    const shaped = await lines.next();
    expect(shaped).toBe(
      '{"jsonrpc": "2.0", "id": 5, "result": {"tools": [{"name": "nope", "inputSchema": {"type": "array", "items": [{"type": "string"}], "additionalItems": false}}]}}',
    );

    expect(lines.stderr()).toContain("fixture-stderr");
    child.stdin.end();
    const [code] = (await once(child, "exit")) as [number | null];
    expect(code).toBe(0);
  });

  it("reassembles a tools/list response written in chunks", async () => {
    const child = spawnCli(["--", process.execPath, fixturePath("chunk-server.mjs")]);
    const lines = readLines(child);
    child.stdin.write(rpc(1, "tools/list"));
    const response = JSON.parse(await lines.next()) as {
      result: { tools: Array<{ inputSchema: Record<string, unknown> }> };
    };
    expect(response.result.tools[0]?.inputSchema).toMatchObject({
      $schema: JSON_SCHEMA_DRAFT_2020_12,
      prefixItems: [{ type: "string" }, { type: "number" }],
      items: false,
    });
    child.stdin.end();
    await once(child, "exit");
  });

  it("forwards the server exit code", async () => {
    const result = await runCli(["--", process.execPath, fixturePath("exit-code.mjs")]);
    expect(result.stdout).toBe("bye\n");
    expect(result.code).toBe(3);
  });

  it("exits 2 when the server cannot be started and does not write protocol stdout", async () => {
    const result = await runCli(["--", "definitely-missing-mcp-dialect-bin"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("failed to start server");
  });

  it("forwards SIGTERM to the server", async () => {
    const child = spawnCli(["--", process.execPath, fixturePath("draft07-server.mjs")]);
    const lines = readLines(child);
    await lines.next();
    const stderrReady = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("stderr timeout")), 3000);
      const check = (): void => {
        if (lines.stderr().includes("fixture-stderr")) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stderr.on("data", check);
      check();
    });
    await stderrReady;
    child.kill("SIGTERM");
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    expect(signal === "SIGTERM" || code === 143).toBe(true);
  });
});
