export type CliMode = "help" | "version" | "proxy" | "check";

export interface CliArgs {
  mode: CliMode;
  command: string[];
}

export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0) {
    return { mode: "help", command: [] };
  }

  const separator = argv.indexOf("--");
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  const after = separator === -1 ? [] : argv.slice(separator + 1);

  if (flags.includes("--help") || flags.includes("-h")) {
    return { mode: "help", command: [] };
  }
  if (flags.includes("--version") || flags.includes("-v")) {
    return { mode: "version", command: [] };
  }

  if (flags[0] === "check") {
    const inline = flags.slice(1);
    const command = separator === -1 ? inline : after;
    return { mode: "check", command: [...command] };
  }

  if (separator === -1) {
    return { mode: "proxy", command: [...flags] };
  }
  return { mode: "proxy", command: [...after] };
}

export function helpText(version: string): string {
  return `mcp-dialect-fix ${version}

Rewrite MCP tools/list schemas from JSON Schema draft-07 to 2020-12.

Usage:
  mcp-dialect-fix -- <command> [args...]
  mcp-dialect-fix check -- <command> [args...]
  mcp-dialect-fix --help
  mcp-dialect-fix --version

Proxy mode spawns the server and copies newline-delimited JSON-RPC between
the client (this process's stdin/stdout) and the server. tools/list results
are rewritten. Every other line is forwarded unchanged, including non-JSON
lines. Server stderr is copied to this process's stderr. stdout is only the
protocol channel. The server's exit code is forwarded, and SIGINT, SIGTERM,
and SIGHUP are forwarded to the server.

check spawns the server, sends initialize and notifications/initialized, then
tools/list, following nextCursor. It prints a short report and exits 1 when
any tool inputSchema or outputSchema is not JSON Schema 2020-12. It exits 2
if the server cannot be started or does not finish within 15 seconds.
`;
}
