import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";

/**
 * Split a UTF-8 byte stream into lines. The delimiter is `\n` and is not
 * included in the line. A final chunk without a newline is delivered to
 * `onRest` when the stream ends.
 */
export function attachLines(
  stream: Readable,
  onLine: (line: string) => void,
  onRest: (rest: string) => void,
): void {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const consume = (text: string, final: boolean): void => {
    buffer += text;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (final && buffer.length > 0) {
      onRest(buffer);
      buffer = "";
    }
  };

  stream.on("data", (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
    consume(text, false);
  });
  stream.on("end", () => {
    consume(decoder.end(), true);
  });
}
