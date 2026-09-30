import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

export interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: readonly string[], input?: string): Promise<CliResult> {
  const child = spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return collect(child, input);
}

export function spawnCli(args: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    cwd: repoRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function collect(child: ChildProcessWithoutNullStreams, input?: string): Promise<CliResult> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function readLines(child: ChildProcessWithoutNullStreams): {
  next: () => Promise<string>;
  stderr: () => string;
} {
  const lines: string[] = [];
  let buffer = "";
  let stderr = "";
  let notify: (() => void) | undefined;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const wake = (): void => {
    notify?.();
  };
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      lines.push(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (lines.length > 0) wake();
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return {
    stderr: () => stderr,
    next: () =>
      new Promise((resolve, reject) => {
        if (lines.length > 0) {
          resolve(lines.shift() ?? "");
          return;
        }
        const timer = setTimeout(() => {
          notify = undefined;
          reject(new Error(`timed out waiting for stdout; stderr=${stderr}`));
        }, 4000);
        notify = () => {
          if (lines.length === 0) return;
          clearTimeout(timer);
          notify = undefined;
          resolve(lines.shift() ?? "");
        };
      }),
  };
}
