import readline from "node:readline";

const echoTool = {
  name: "echo",
  description: "echo text",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
    additionalProperties: false,
  },
  outputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      sum: { type: "number" },
      pair: {
        type: "array",
        items: [{ type: "string" }, { type: "number" }],
        additionalItems: false,
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["sum", "pair"],
    additionalProperties: false,
  },
};

const lookupTool = {
  name: "lookup",
  description: "lookup by id",
  inputSchema: {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      id: { $ref: "#/definitions/Id" },
    },
    required: ["id"],
    additionalProperties: false,
    definitions: {
      Id: { type: "string" },
    },
  },
};

process.stderr.write("fixture-stderr\n");
process.stdout.write("not-json leftover\n");

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
      `{"jsonrpc":"2.0", "id":${JSON.stringify(msg.id)}, "result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"draft07-fixture","version":"0.0.0"}}}\n`,
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
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params?.name ?? "";
    const text = msg.params?.arguments?.text ?? "";
    process.stdout.write(
      `{"jsonrpc":"2.0","id":${JSON.stringify(msg.id)},"result":{"content":[{"type":"text","text":"called:${name}:${text}"}],"untouched":true}}\n`,
    );
    return;
  }
  if (msg.method === "emit-shaped") {
    process.stdout.write(
      `{"jsonrpc": "2.0", "id": ${JSON.stringify(msg.id)}, "result": {"tools": [{"name": "nope", "inputSchema": {"type": "array", "items": [{"type": "string"}], "additionalItems": false}}]}}\n`,
    );
  }
});

rl.on("close", () => {
  process.exit(0);
});
