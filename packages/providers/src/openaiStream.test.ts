import { describe, expect, it } from "vitest";
import { GatewayError } from "./gatewayErrors.js";
import { consumeOpenAIStream } from "./openaiStream.js";

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const text = frames.map((f) => `data: ${f}\n\n`).join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("consumeOpenAIStream gateway errors", () => {
  it("throws GatewayError with partial=true after text deltas", async () => {
    const body = sseBody([
      JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }),
      JSON.stringify({ error: "insufficient_credits" }),
    ]);

    let received = "";
    try {
      await consumeOpenAIStream(body, "auto", async (event) => {
        if (event.type === "text_delta") received += event.text;
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).code).toBe("insufficient_credits");
      expect((e as GatewayError).partial).toBe(true);
      expect(received).toBe("Hello");
    }
  });

  it("throws GatewayError with partial=false when no output was streamed", async () => {
    const body = sseBody([JSON.stringify({ error: "insufficient_credits" })]);
    try {
      await consumeOpenAIStream(body, "auto");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GatewayError);
      expect((e as GatewayError).partial).toBe(false);
    }
  });

  it("maps idle timeout SSE frames to upstream_timeout", async () => {
    const body = sseBody([
      JSON.stringify({ error: "Upstream idle timeout after 60000ms" }),
    ]);
    await expect(consumeOpenAIStream(body, "auto")).rejects.toMatchObject({
      code: "upstream_timeout",
    });
  });
});
