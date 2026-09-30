import { describe, expect, it } from "vitest";
import { checkServer } from "../src/check.js";
import { cliPath, fixturePath, runCli } from "./helpers.js";

const draftReport = `2 tool(s) are not JSON Schema 2020-12.

echo
  inputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"
  outputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - items is an array at /properties/pair
    - additionalItems is present at /properties/pair
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"

lookup
  inputSchema:
    - $schema is http://json-schema.org/draft-07/schema#
    - definitions is present
    - strict Ajv 2020: no schema with key or ref "http://json-schema.org/draft-07/schema#"
`;

describe("check", () => {
  it("names draft-07 tools and exits 1", async () => {
    const result = await runCli(["check", "--", process.execPath, fixturePath("draft07-server.mjs")]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe(draftReport);
    expect(result.stderr).toContain("fixture-stderr");
  });

  it("exits 0 for a 2020-12 server, including format annotations", async () => {
    const result = await runCli(["check", "--", process.execPath, fixturePath("clean-server.mjs")]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("OK: 2 tool(s) use JSON Schema 2020-12.\n");
  });

  it("exits 0 when the draft server is wrapped in the proxy", async () => {
    const result = await runCli([
      "check",
      "--",
      process.execPath,
      "--import",
      "tsx",
      cliPath,
      "--",
      process.execPath,
      fixturePath("draft07-server.mjs"),
    ]);
    expect(result.stderr).not.toContain("failed to start");
    expect(result.stdout).toBe("OK: 2 tool(s) use JSON Schema 2020-12.\n");
    expect(result.code).toBe(0);
  });

  it("exits 2 when the server binary is missing", async () => {
    const result = await runCli(["check", "--", "definitely-missing-mcp-dialect-bin"]);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("failed to start server");
  });

  it("exits 2 when the server does not answer", async () => {
    const result = await checkServer([process.execPath, fixturePath("hang-server.mjs")], { timeoutMs: 300 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("timed out after 300ms");
  });

  it("prints help and version", async () => {
    const help = await runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("mcp-dialect-fix 0.1.0");
    expect(help.stdout).toContain("mcp-dialect-fix check --");
    const version = await runCli(["--version"]);
    expect(version.stdout).toBe("0.1.0\n");
    expect(version.code).toBe(0);
    const missing = await runCli(["check"]);
    expect(missing.code).toBe(2);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("missing server command");
  });
});
