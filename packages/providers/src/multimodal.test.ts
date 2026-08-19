import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { Message } from "./types.js";
import { hasImageParts } from "./types.js";
import { findModelAnywhere } from "./catalog.js";

function emptySseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAg1KH9+8AAAAASUVORK5CYII=";

describe("hasImageParts", () => {
  it("detects image content parts on a message", () => {
    const withImage: Message = {
      role: "user",
      content: "look at this",
      parts: [{ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }],
    };
    const withoutImage: Message = { role: "user", content: "just text" };
    expect(hasImageParts(withImage)).toBe(true);
    expect(hasImageParts(withoutImage)).toBe(false);
  });
});

describe("catalog vision flags", () => {
  it("marks known multimodal models as vision-capable", () => {
    expect(findModelAnywhere("claude-sonnet-4-20250514")?.vision).toBe(true);
    expect(findModelAnywhere("gpt-4o")?.vision).toBe(true);
  });

  it("leaves text-only models without the vision flag", () => {
    expect(findModelAnywhere("deepseek-v4-flash")?.vision).toBeFalsy();
  });
});

describe("AnthropicProvider multimodal request shaping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an image content block alongside text for messages with image parts", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({
      messages: [
        {
          role: "user",
          content: "What is in this image?",
          parts: [{ type: "image", mimeType: "image/png", data: TINY_PNG_BASE64 }],
        },
      ],
    });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(1);
    const content = messages[0]!.content as Array<Record<string, unknown>>;
    expect(content.some((b) => b.type === "text")).toBe(true);
    const imageBlock = content.find((b) => b.type === "image") as
      | { source: { type: string; media_type: string; data: string } }
      | undefined;
    expect(imageBlock?.source.media_type).toBe("image/png");
    expect(imageBlock?.source.data).toBe(TINY_PNG_BASE64);
    expect(imageBlock?.source.type).toBe("base64");
  });

  it("leaves plain-text messages untouched (no content array)", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({ messages: [{ role: "user", content: "hello" }] });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]!.content).toBe("hello");
  });

  it("folds a user message following tool results into the same turn", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "a.ts" } }],
        },
        { role: "tool", content: "file body", toolCallId: "t1", name: "read_file" },
        { role: "user", content: "[Workspace state] note" },
      ],
    });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    // Anthropic requires alternating roles: the trailing user text must ride
    // along with the tool_result blocks, and after them.
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const blocks = messages[2]!.content as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(blocks[1]!.text).toBe("[Workspace state] note");
  });

  it("replays signed thinking blocks first on an assistant tool turn", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "Reading the file.",
          toolCalls: [{ id: "t1", name: "read_file", arguments: { path: "a.ts" } }],
          reasoningBlocks: [
            { type: "thinking", thinking: "I should read a.ts", signature: "sig-1" },
            { type: "redacted_thinking", data: "EncRypTeD==" },
          ],
        },
        { role: "tool", content: "file body", toolCallId: "t1", name: "read_file" },
      ],
      thinkingBudgetTokens: 4_000,
    });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    const blocks = messages[1]!.content as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b.type)).toEqual([
      "thinking",
      "redacted_thinking",
      "text",
      "tool_use",
    ]);
    expect(blocks[0]).toEqual({
      type: "thinking",
      thinking: "I should read a.ts",
      signature: "sig-1",
    });
    expect(blocks[1]).toEqual({ type: "redacted_thinking", data: "EncRypTeD==" });
  });

  it("folds two consecutive plain user messages, as sent at the start of a run", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    await provider.complete({
      messages: [
        { role: "user", content: "[Workspace state] note" },
        { role: "user", content: "the task" },
      ],
    });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(1);
    const blocks = messages[0]!.content as Array<Record<string, unknown>>;
    expect(blocks.map((b) => b.text)).toEqual(["[Workspace state] note", "the task"]);
  });
});

describe("OpenAICompatibleProvider multimodal request shaping", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an image_url content part with a data URL for messages with image parts", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return emptySseResponse();
      }),
    );

    const provider = new OpenAICompatibleProvider({ apiKey: "test-key" });
    await provider.complete({
      messages: [
        {
          role: "user",
          content: "Describe this",
          parts: [{ type: "image", mimeType: "image/jpeg", data: TINY_PNG_BASE64 }],
        },
      ],
    });

    const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
    const content = messages[0]!.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "text", text: "Describe this" });
    const imagePart = content[1] as { type: string; image_url: { url: string } };
    expect(imagePart.type).toBe("image_url");
    expect(imagePart.image_url.url).toBe(`data:image/jpeg;base64,${TINY_PNG_BASE64}`);
  });
});
