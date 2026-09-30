import readline from "node:readline";

const echoTool = {
  name: "echo",
  description: "echo text",
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      text: { type: "string", format: "email" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      pair: {
        type: "array",
        prefixItems: [{ type: "string" }, { type: "number" }],
        items: false,
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["pair"],
    additionalProperties: false,
  },
};

const lookupTool = {
  name: "lookup",
  description: "lookup by id",
  inputSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      id: { $ref: "#/$defs/Id" },
    },
    required: ["id"],
    additionalProperties: false,
    $defs: {
      Id: { type: "string" },
    },
  },
};

process.stderr.write("clean-stderr\n");

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "clean-fixture", version: "0.0.0" },
        },
      })}\n`,
    );
    return;
  }
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") {
    if (msg.params?.cursor === "2") {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [lookupTool] } })}\n`);
      return;
    }
    process.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [echoTool], nextCursor: "2" } })}\n`,
    );
  }
});

rl.on("close", () => {
  process.exit(0);
});
