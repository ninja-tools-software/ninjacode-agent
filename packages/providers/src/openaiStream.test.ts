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

describe("consumeOpenAIStream tool call assembly", () => {
  it("joins argument fragments split across chunks", async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_a", function: { name: "read_file", arguments: "" } }],
            },
          },
        ],
      }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] } }] }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }],
      }),
      JSON.stringify({ choices: [{ finish_reason: "tool_calls", delta: {} }] }),
    ]);

    const events: string[] = [];
    const completion = await consumeOpenAIStream(body, "gpt-4o", async (event) => {
      events.push(event.type);
    });

    expect(completion.toolCalls).toEqual([
      { id: "call_a", name: "read_file", arguments: { path: "a.ts" } },
    ]);
    expect(completion.stopReason).toBe("tool_use");
    expect(events.filter((type) => type === "tool_call_start")).toHaveLength(1);
    expect(events.filter((type) => type === "tool_call_delta")).toHaveLength(2);
    expect(events.filter((type) => type === "tool_call_end")).toHaveLength(1);
  });

  it("keeps parallel tool calls apart and ordered by index", async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: "call_second", function: { name: "grep", arguments: "" } },
                { index: 0, id: "call_first", function: { name: "glob", arguments: "" } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { arguments: '{"pattern":"x"}' } },
                { index: 0, function: { arguments: '{"pattern":"**/*.ts"}' } },
              ],
            },
          },
        ],
      }),
    ]);

    const completion = await consumeOpenAIStream(body, "gpt-4o");

    expect(completion.toolCalls.map((tc) => tc.name)).toEqual(["glob", "grep"]);
    expect(completion.toolCalls[0]!.arguments).toEqual({ pattern: "**/*.ts" });
    expect(completion.toolCalls[1]!.arguments).toEqual({ pattern: "x" });
  });

  it("announces the tool only once its name has arrived", async () => {
    const body = sseBody([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a" }] } }] }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "grep", arguments: "{}" } }] } }],
      }),
    ]);

    const started: string[] = [];
    const completion = await consumeOpenAIStream(body, "gpt-4o", async (event) => {
      if (event.type === "tool_call_start") started.push(event.name);
    });

    // The name only exists in the second chunk, so the accumulator has to adopt it.
    expect(completion.toolCalls).toEqual([{ id: "call_a", name: "grep", arguments: {} }]);
    expect(started).toEqual([]);
  });

  it("drops a tool call that never received a name", async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }],
      }),
    ]);

    const completion = await consumeOpenAIStream(body, "gpt-4o");
    expect(completion.toolCalls).toEqual([]);
  });

  it("surfaces unparsable arguments instead of losing the call", async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_a", function: { name: "grep", arguments: '{"broken' } }],
            },
          },
        ],
      }),
    ]);

    const completion = await consumeOpenAIStream(body, "gpt-4o");
    expect(completion.toolCalls[0]!.name).toBe("grep");
    expect(completion.toolCalls[0]!.arguments).toMatchObject({ _truncated: true });
  });

  it("reports cached prompt tokens as a disjoint bucket", async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [{ delta: { content: "hi" } }],
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 800 },
        },
      }),
    ]);

    const completion = await consumeOpenAIStream(body, "gpt-4o");
    expect(completion.usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 800,
    });
  });
});
