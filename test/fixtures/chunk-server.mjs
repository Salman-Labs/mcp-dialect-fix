import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method !== "tools/list") return;
  const payload =
    JSON.stringify({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "chunked",
            inputSchema: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "array",
              items: [{ type: "string" }, { type: "number" }],
              additionalItems: false,
              minItems: 2,
              maxItems: 2,
            },
          },
        ],
      },
    }) + "\n";

  const parts = [payload.slice(0, 5), payload.slice(5, 40), payload.slice(40)];
  let index = 0;
  const writeNext = () => {
    if (index >= parts.length) return;
    const part = parts[index];
    index += 1;
    process.stdout.write(part, () => {
      setTimeout(writeNext, 20);
    });
  };
  writeNext();
});

rl.on("close", () => {
  process.exit(0);
});
