import { afterEach, describe, expect, it, vi } from "vitest";
import { NinjaCodeGatewayProvider } from "./gateway.js";
import { createDeepSeekProvider } from "./openai-compatible.js";

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

const USAGE_CHUNK =
  'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":8}}}\n\n';
const TEXT_CHUNK = 'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n';

describe("prompt caching wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets prompt_cache_key for the ninjacode gateway provider", async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body) as Record<string, unknown>;
        return sseResponse([TEXT_CHUNK, USAGE_CHUNK, "data: [DONE]\n\n"]);
      }),
    );
    const provider = new NinjaCodeGatewayProvider({ apiKey: "k" });
    const completion = await provider.completeStreaming({
      messages: [{ role: "user", content: "hi" }],
      cacheSystemPrompt: true,
    });
    expect(captured.prompt_cache_key).toBe("ninjacode:auto:system");
    expect(completion.usage.cacheReadTokens).toBe(8);
  });

  it("does not set prompt_cache_key for providers without cache routing", async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        captured = JSON.parse(init.body) as Record<string, unknown>;
        return sseResponse([TEXT_CHUNK, "data: [DONE]\n\n"]);
      }),
    );
    const provider = createDeepSeekProvider("k");
    await provider.completeStreaming({
      messages: [{ role: "user", content: "hi" }],
      cacheSystemPrompt: true,
    });
    expect(captured.prompt_cache_key).toBeUndefined();
  });

  it("splits prompt_tokens into disjoint uncached and cache-read buckets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([TEXT_CHUNK, USAGE_CHUNK, "data: [DONE]\n\n"])),
    );
    const provider = createDeepSeekProvider("k");
    const completion = await provider.completeStreaming({
      messages: [{ role: "user", content: "hi" }],
    });
    // prompt_tokens=10 includes 8 cached; inputTokens must report only the uncached share.
    expect(completion.usage.inputTokens).toBe(2);
    expect(completion.usage.cacheReadTokens).toBe(8);
  });
});
