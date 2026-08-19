import { describe, expect, it } from "vitest";
import { consumeAnthropicStream } from "./anthropicStream.js";
import { LlmError, type StreamEvent } from "./types.js";

function sseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

function collect(): { sink: (event: StreamEvent) => void; events: StreamEvent[] } {
  const events: StreamEvent[] = [];
  return { sink: (event) => events.push(event), events };
}

const messageStart = {
  type: "message_start",
  message: {
    usage: {
      input_tokens: 120,
      output_tokens: 0,
      cache_read_input_tokens: 4_000,
      cache_creation_input_tokens: 12,
    },
  },
};

describe("consumeAnthropicStream", () => {
  it("streams thinking as reasoning and keeps the signed block for replay", async () => {
    const { sink, events } = collect();
    const completion = await consumeAnthropicStream(
      sseStream([
        messageStart,
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me " } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "check." } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "abc" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Done." } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } },
      ]),
      "claude-sonnet-4-20250514",
      sink,
    );

    expect(completion.reasoning).toBe("Let me check.");
    expect(completion.reasoningBlocks).toEqual([
      { type: "thinking", thinking: "Let me check.", signature: "sig-abc" },
    ]);
    expect(completion.text).toBe("Done.");
    expect(completion.stopReason).toBe("end");
    expect(events.filter((e) => e.type === "reasoning_delta")).toEqual([
      { type: "reasoning_delta", text: "Let me " },
      { type: "reasoning_delta", text: "check." },
    ]);
  });

  it("drops an unsigned thinking block, which would be rejected on replay", async () => {
    const completion = await consumeAnthropicStream(
      sseStream([
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "partial" } },
        { type: "content_block_stop", index: 0 },
      ]),
      "claude-sonnet-4-20250514",
    );

    expect(completion.reasoning).toBe("partial");
    expect(completion.reasoningBlocks).toBeUndefined();
  });

  it("round-trips redacted thinking verbatim", async () => {
    const completion = await consumeAnthropicStream(
      sseStream([
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "redacted_thinking", data: "EncRypTeD==" },
        },
        { type: "content_block_stop", index: 0 },
      ]),
      "claude-sonnet-4-20250514",
    );

    expect(completion.reasoningBlocks).toEqual([{ type: "redacted_thinking", data: "EncRypTeD==" }]);
    expect(completion.reasoning).toBeUndefined();
  });

  it("assembles a tool call from fragmented input deltas", async () => {
    const { sink, events } = collect();
    const completion = await consumeAnthropicStream(
      sseStream([
        messageStart,
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "toolu_1", name: "read_file" },
        },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"pa' } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'th":"a.ts"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } },
      ]),
      "claude-sonnet-4-20250514",
      sink,
    );

    expect(completion.toolCalls).toEqual([
      { id: "toolu_1", name: "read_file", arguments: { path: "a.ts" } },
    ]);
    expect(completion.stopReason).toBe("tool_use");
    expect(events.map((e) => e.type)).toEqual([
      "usage",
      "tool_call_start",
      "tool_call_delta",
      "tool_call_delta",
      "tool_call_end",
      "done",
    ]);
  });

  it("interleaves thinking with a tool call in one turn", async () => {
    const completion = await consumeAnthropicStream(
      sseStream([
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "plan" } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "s1" } },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_2", name: "grep" },
        },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } },
        { type: "content_block_stop", index: 1 },
      ]),
      "claude-sonnet-4-20250514",
    );

    expect(completion.reasoningBlocks).toHaveLength(1);
    expect(completion.toolCalls).toHaveLength(1);
    expect(completion.stopReason).toBe("tool_use");
  });

  it("reports cache usage from message_start", async () => {
    const completion = await consumeAnthropicStream(sseStream([messageStart]), "model");
    expect(completion.usage).toMatchObject({
      inputTokens: 120,
      cacheReadTokens: 4_000,
      cacheWriteTokens: 12,
    });
  });

  it("maps a mid-stream overload to a retryable status and emits error first", async () => {
    const { sink, events } = collect();

    await expect(
      consumeAnthropicStream(
        sseStream([
          messageStart,
          { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        ]),
        "claude-sonnet-4-20250514",
        sink,
      ),
    ).rejects.toMatchObject({ name: "LlmError", status: 529, provider: "anthropic" });

    expect(events.at(-1)).toEqual({ type: "error", error: "Overloaded" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("keeps an unknown stream error status-less so it is not blindly retried", async () => {
    await expect(
      consumeAnthropicStream(
        sseStream([{ type: "error", error: { type: "weird_error" } }]),
        "model",
      ),
    ).rejects.toSatisfy((e) => e instanceof LlmError && e.status === undefined);
  });

  it("ignores unknown events and malformed payloads", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
        controller.enqueue(encoder.encode("data: not-json\n\n"));
        controller.enqueue(encoder.encode('data: {"type":"ping"}\n\n'));
        controller.enqueue(
          encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n'),
        );
        controller.close();
      },
    });

    const completion = await consumeAnthropicStream(body, "model");
    expect(completion.text).toBe("hi");
  });
});
