import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
import { AnthropicProvider } from "./anthropic.js";
import { createXaiProvider } from "./openai-compatible.js";
import { llmFetchInit } from "./llmTransport.js";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const OPENAI_CHUNKS = [
  'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n',
  'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
  "data: [DONE]\n\n",
];
const ANTHROPIC_CHUNKS = [
  'event: message_start\ndata: {"message":{"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
  'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"hi"}}\n\n',
  'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
  "event: message_stop\ndata: {}\n\n",
];

function captureFetch(chunks: string[]): { inits: RequestInit[] } {
  const inits: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      inits.push(init);
      return sseResponse(chunks);
    }),
  );
  return { inits };
}

describe("LLM streaming transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the request signal and adds a dispatcher", () => {
    const controller = new AbortController();
    const init = llmFetchInit({ method: "POST", signal: controller.signal });

    expect(init.signal).toBe(controller.signal);
    expect(init.method).toBe("POST");
    expect(init.dispatcher).toBeDefined();
  });

  it("reuses one dispatcher across calls so sockets are pooled", () => {
    expect(llmFetchInit({}).dispatcher).toBe(llmFetchInit({}).dispatcher);
  });

  // A reasoning model can stay silent past undici's 300s default, which would
  // otherwise kill the socket mid-thought and lose the whole turn.
  it("configures the transport with an undici agent, not the global default", () => {
    expect(llmFetchInit({}).dispatcher).toBeInstanceOf(Agent);
  });

  it("sends the dispatcher on openai-compatible streaming calls", async () => {
    const { inits } = captureFetch(OPENAI_CHUNKS);
    const provider = createXaiProvider("k");

    await provider.completeStreaming({ messages: [{ role: "user", content: "hi" }] });

    expect(inits).toHaveLength(1);
    expect((inits[0] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });

  it("sends the dispatcher on anthropic streaming calls", async () => {
    const { inits } = captureFetch(ANTHROPIC_CHUNKS);
    const provider = new AnthropicProvider({ apiKey: "k" });

    await provider.completeStreaming({ messages: [{ role: "user", content: "hi" }] });

    expect(inits).toHaveLength(1);
    expect((inits[0] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });
});
