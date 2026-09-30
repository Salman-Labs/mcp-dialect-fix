import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import {
  createPendingIds,
  noteToolsListRequest,
  parseJsonLine,
  rewriteToolsListResponse,
} from "./jsonrpc.js";
import { attachLines } from "./lines.js";

const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

const SIGNAL_CODE: Record<(typeof FORWARDED_SIGNALS)[number], number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
};

/**
 * Proxy newline-delimited JSON-RPC between this process and a spawned MCP
 * server. Only `tools/list` results are rewritten. stdout is reserved for
 * the protocol.
 */
export function proxyStdio(command: readonly string[]): void {
  if (command.length === 0) {
    throw new Error("missing server command");
  }
  const [cmd, ...args] = command;
  if (!cmd) throw new Error("missing server command");

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const pending = createPendingIds();
  const relays = new Map<NodeJS.Signals, () => void>();

  child.on("error", (error) => {
    process.stderr.write(`mcp-dialect-fix: failed to start server: ${error.message}\n`);
    process.exit(2);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  child.stdin?.on("error", () => {
    // The server closed stdin (EPIPE) while a write was in flight.
  });

  for (const signal of FORWARDED_SIGNALS) {
    const relay = (): void => {
      if (!child.killed) child.kill(signal);
    };
    relays.set(signal, relay);
    process.on(signal, relay);
  }

  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin || !stdout) {
    process.stderr.write("mcp-dialect-fix: failed to open server stdio\n");
    process.exit(2);
  }

  attachLines(
    process.stdin,
    (line) => {
      noteClientLine(line, pending);
      writeChunk(stdin, process.stdin, `${line}\n`);
    },
    (rest) => {
      noteClientLine(rest, pending);
      writeChunk(stdin, process.stdin, rest);
    },
  );
  process.stdin.on("end", () => {
    stdin.end();
  });

  let stdoutEnded = false;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  const finishIfReady = (): void => {
    if (!stdoutEnded || !exitInfo) return;
    const { code, signal } = exitInfo;
    const done = (): void => {
      if (signal) {
        const relay = relays.get(signal);
        if (relay) process.removeListener(signal, relay);
        try {
          process.kill(process.pid, signal);
        } catch {
          process.exit(128 + (SIGNAL_CODE[signal as (typeof FORWARDED_SIGNALS)[number]] ?? 1));
        }
        setTimeout(() => {
          process.exit(128 + (SIGNAL_CODE[signal as (typeof FORWARDED_SIGNALS)[number]] ?? 1));
        }, 50).unref();
        return;
      }
      process.exit(code ?? 1);
    };
    if (process.stdout.writableLength > 0) {
      process.stdout.write("", () => done());
    } else {
      done();
    }
  };

  attachLines(
    stdout,
    (line) => {
      writeChunk(process.stdout, stdout, rewriteServerLine(line, pending, true));
    },
    (rest) => {
      writeChunk(process.stdout, stdout, rewriteServerLine(rest, pending, false));
    },
  );
  stdout.on("end", () => {
    stdoutEnded = true;
    finishIfReady();
  });
  child.on("exit", (code, signal) => {
    exitInfo = { code, signal };
    finishIfReady();
  });
}

function noteClientLine(line: string, pending: Set<string>): void {
  noteToolsListRequest(parseJsonLine(line), pending);
}

function rewriteServerLine(line: string, pending: Set<string>, hadNewline: boolean): string {
  const parsed = parseJsonLine(line);
  if (parsed === undefined) {
    return hadNewline ? `${line}\n` : line;
  }
  const rewritten = rewriteToolsListResponse(parsed, pending);
  if (rewritten === parsed) {
    return hadNewline ? `${line}\n` : line;
  }
  return `${JSON.stringify(rewritten)}\n`;
}

function writeChunk(dest: Writable, source: Readable | null, chunk: string): void {
  const ok = dest.write(chunk);
  if (!ok && source) {
    source.pause();
    dest.once("drain", () => {
      source.resume();
    });
  }
}
