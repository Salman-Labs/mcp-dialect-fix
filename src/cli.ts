#!/usr/bin/env node
import { parseArgs, helpText } from "./args.js";
import { checkServer } from "./check.js";
import { proxyStdio } from "./proxy.js";
import { packageVersion } from "./version.js";

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.mode === "help") {
    process.stdout.write(helpText(packageVersion));
    return;
  }
  if (parsed.mode === "version") {
    process.stdout.write(`${packageVersion}\n`);
    return;
  }
  if (parsed.command.length === 0) {
    process.stderr.write("mcp-dialect-fix: missing server command\n");
    process.exit(2);
  }
  if (parsed.mode === "check") {
    checkServer(parsed.command)
      .then((report) => {
        if (report.stderr) process.stderr.write(report.stderr);
        if (report.stdout) process.stdout.write(report.stdout);
        process.exit(report.exitCode);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`mcp-dialect-fix: ${message}\n`);
        process.exit(2);
      });
    return;
  }

  try {
    proxyStdio(parsed.command);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-dialect-fix: ${message}\n`);
    process.exit(2);
  }
}

main();
