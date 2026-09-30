import { spawn, type ChildProcess } from "node:child_process";
import { findDialectProblems } from "./problems.js";
import { idKey, parseJsonLine } from "./jsonrpc.js";
import { attachLines } from "./lines.js";
import { isPlainObject, type JsonObject } from "./object.js";
import { packageVersion } from "./version.js";

export const CHECK_TIMEOUT_MS = 15_000;
const MAX_PAGES = 100;

export interface CheckReport {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface SlotFailure {
  slot: "inputSchema" | "outputSchema";
  messages: string[];
}

interface ToolFailure {
  name: string;
  slots: SlotFailure[];
}

interface PendingRequest {
  resolve: (message: JsonObject) => void;
  reject: (error: Error) => void;
}

/**
 * Spawn an MCP server, list its tools, and report schemas that are not
 * JSON Schema 2020-12. Exit 0 when every schema passes, 1 when any tool
 * fails, and 2 when the server cannot be started or does not answer in time.
 */
export async function checkServer(
  command: readonly string[],
  options?: { timeoutMs?: number },
): Promise<CheckReport> {
  if (command.length === 0) {
    return {
      exitCode: 2,
      stdout: "",
      stderr: "mcp-dialect-fix: missing server command\n",
    };
  }

  const timeoutMs = options?.timeoutMs ?? CHECK_TIMEOUT_MS;
  const [cmd, ...args] = command;
  if (!cmd) {
    return { exitCode: 2, stdout: "", stderr: "mcp-dialect-fix: missing server command\n" };
  }

  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  return await new Promise<CheckReport>((resolve) => {
    let settled = false;
    let serverStderr = "";
    const pending = new Map<string, PendingRequest>();

    const finish = (report: CheckReport): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const waiter of pending.values()) {
        waiter.reject(new Error("check finished"));
      }
      pending.clear();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
      resolve({
        exitCode: report.exitCode,
        stdout: report.stdout,
        stderr: `${serverStderr}${report.stderr}`,
      });
    };

    const timer = setTimeout(() => {
      finish({
        exitCode: 2,
        stdout: "",
        stderr: `mcp-dialect-fix: timed out after ${timeoutMs}ms waiting for the server\n`,
      });
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      serverStderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      finish({
        exitCode: 2,
        stdout: "",
        stderr: `mcp-dialect-fix: failed to start server: ${error.message}\n`,
      });
    });
    child.stdin?.on("error", () => {
      // Server closed its stdin.
    });
    child.on("exit", (code, signal) => {
      setImmediate(() => {
        if (settled) return;
        const why = signal ? `signal ${signal}` : `code ${code ?? "null"}`;
        finish({
          exitCode: 2,
          stdout: "",
          stderr: `mcp-dialect-fix: server exited before tools/list completed (${why})\n`,
        });
      });
    });

    if (!child.stdout || !child.stdin) {
      finish({ exitCode: 2, stdout: "", stderr: "mcp-dialect-fix: failed to open server stdio\n" });
      return;
    }

    attachLines(
      child.stdout,
      (line) => {
        const parsed = parseJsonLine(line);
        if (!isPlainObject(parsed) || !Object.hasOwn(parsed, "id") || typeof parsed.method === "string") {
          return;
        }
        const key = idKey(parsed.id);
        const waiter = key ? pending.get(key) : undefined;
        if (!key || !waiter) return;
        pending.delete(key);
        waiter.resolve(parsed);
      },
      () => {
        // A trailing partial line is not a framed JSON-RPC message.
      },
    );

    void run(child, pending, finish).catch((error: unknown) => {
      if (settled) return;
      const message = error instanceof Error ? error.message : String(error);
      finish({
        exitCode: 2,
        stdout: "",
        stderr: `mcp-dialect-fix: ${message}\n`,
      });
    });
  });
}

async function run(
  child: ChildProcess,
  pending: Map<string, PendingRequest>,
  finish: (report: CheckReport) => void,
): Promise<void> {
  const stdin = child.stdin;
  if (!stdin) throw new Error("failed to open server stdin");

  let nextId = 1;
  const request = (method: string, params?: unknown): Promise<JsonObject> => {
    const id = nextId++;
    const key = idKey(id);
    if (!key) throw new Error("internal error allocating request id");
    const response = new Promise<JsonObject>((resolve, reject) => {
      pending.set(key, { resolve, reject });
    });
    const message: JsonObject = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  };

  const notify = (method: string): void => {
    stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  };

  const initialize = await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "mcp-dialect-fix", version: packageVersion },
  });
  if (initialize.error !== undefined) {
    finish({
      exitCode: 2,
      stdout: "",
      stderr: "mcp-dialect-fix: server rejected initialize\n",
    });
    return;
  }
  notify("notifications/initialized");

  const tools: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const response = await request("tools/list", cursor === undefined ? undefined : { cursor });
    if (response.error !== undefined || !isPlainObject(response.result) || !Array.isArray(response.result.tools)) {
      finish({
        exitCode: 2,
        stdout: "",
        stderr: "mcp-dialect-fix: tools/list did not return a tool list\n",
      });
      return;
    }
    tools.push(...response.result.tools);
    const nextCursor = response.result.nextCursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) break;
    if (seenCursors.has(nextCursor)) {
      finish({
        exitCode: 2,
        stdout: "",
        stderr: "mcp-dialect-fix: tools/list repeated a pagination cursor\n",
      });
      return;
    }
    seenCursors.add(nextCursor);
    if (seenCursors.size > MAX_PAGES) {
      finish({
        exitCode: 2,
        stdout: "",
        stderr: "mcp-dialect-fix: tools/list exceeded 100 pages\n",
      });
      return;
    }
    cursor = nextCursor;
  }

  const { failures, toolCount } = analyzeTools(tools);
  finish({
    exitCode: failures.length === 0 ? 0 : 1,
    stdout: formatCheckReport(toolCount, failures),
    stderr: "",
  });
}

function analyzeTools(tools: unknown[]): { failures: ToolFailure[]; toolCount: number } {
  const failures: ToolFailure[] = [];
  let toolCount = 0;
  for (const tool of tools) {
    if (!isPlainObject(tool)) continue;
    toolCount += 1;
    const name = typeof tool.name === "string" && tool.name.length > 0 ? tool.name : "(unnamed)";
    const slots: SlotFailure[] = [];
    for (const slot of ["inputSchema", "outputSchema"] as const) {
      if (!Object.hasOwn(tool, slot) || tool[slot] === undefined) continue;
      const messages = findDialectProblems(tool[slot]);
      if (messages.length > 0) slots.push({ slot, messages });
    }
    if (slots.length > 0) failures.push({ name, slots });
  }
  return { failures, toolCount };
}

function formatCheckReport(toolCount: number, failures: ToolFailure[]): string {
  if (failures.length === 0) {
    return `OK: ${toolCount} tool(s) use JSON Schema 2020-12.\n`;
  }
  const lines = [`${failures.length} tool(s) are not JSON Schema 2020-12.`, ""];
  for (const failure of failures) {
    lines.push(failure.name);
    for (const slot of failure.slots) {
      lines.push(`  ${slot.slot}:`);
      for (const message of slot.messages) {
        lines.push(`    - ${message}`);
      }
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
