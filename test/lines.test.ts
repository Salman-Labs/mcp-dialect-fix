import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { attachLines } from "../src/lines.js";

describe("attachLines", () => {
  it("reassembles chunks split inside and across lines", async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    let rest = "";
    attachLines(
      stream,
      (line) => lines.push(line),
      (tail) => {
        rest = tail;
      },
    );

    stream.write(Buffer.from('{"a":'));
    stream.write(Buffer.from('1}\n{"b":'));
    stream.write(Buffer.from("2}\npartial"));
    stream.end();
    await new Promise((resolve) => stream.on("end", resolve));

    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe("partial");
  });
});
