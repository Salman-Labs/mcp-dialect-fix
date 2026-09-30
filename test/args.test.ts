import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";

describe("parseArgs", () => {
  it("defaults to help and recognizes version", () => {
    expect(parseArgs([])).toEqual({ mode: "help", command: [] });
    expect(parseArgs(["--help"])).toEqual({ mode: "help", command: [] });
    expect(parseArgs(["check", "--help"])).toEqual({ mode: "help", command: [] });
    expect(parseArgs(["--version"]).mode).toBe("version");
    expect(parseArgs(["-v"]).mode).toBe("version");
  });

  it("keeps the server command after --", () => {
    expect(parseArgs(["--", "node", "server.js", "--help"])).toEqual({
      mode: "proxy",
      command: ["node", "server.js", "--help"],
    });
    expect(parseArgs(["check", "--", "node", "server.js"])).toEqual({
      mode: "check",
      command: ["node", "server.js"],
    });
    expect(parseArgs(["check", "node", "server.js"])).toEqual({
      mode: "check",
      command: ["node", "server.js"],
    });
    expect(parseArgs(["node", "server.js"])).toEqual({
      mode: "proxy",
      command: ["node", "server.js"],
    });
  });
});
