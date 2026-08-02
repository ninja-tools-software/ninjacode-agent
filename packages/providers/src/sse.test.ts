import { describe, expect, it } from "vitest";
import { parseToolArguments, sseDataLines } from "./sse.js";

describe("sseDataLines", () => {
  it("yields data payloads from SSE chunks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('data: {"a":1}\n\n'));
        controller.enqueue(enc.encode("data: [DONE]\n\ndata: {\"b\":2}\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const data of sseDataLines(stream)) {
      lines.push(data);
    }
    expect(lines).toEqual(['{"a":1}', "[DONE]", '{"b":2}']);
  });

  it("skips non-data lines and empty payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode(": comment\nevent: ping\ndata:\n\ndata: ok\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const data of sseDataLines(stream)) {
      lines.push(data);
    }
    expect(lines).toEqual(["ok"]);
  });
});

describe("parseToolArguments", () => {
  it("returns empty object for blank input", () => {
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments("   ")).toEqual({});
  });

  it("parses valid JSON tool args", () => {
    const args = parseToolArguments('{"path":"a.ts"}');
    expect(args.path).toBe("a.ts");
    expect(args._truncated).toBeUndefined();
  });

  it("marks invalid JSON tool args as truncated", () => {
    const args = parseToolArguments('{"path":"a.ts","content":"unclosed');
    expect(args._truncated).toBe(true);
    expect(typeof args._raw).toBe("string");
  });
});
