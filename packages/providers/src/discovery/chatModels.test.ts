import { describe, expect, it } from "vitest";
import { isChatCompletionModel } from "./chatModels.js";

describe("isChatCompletionModel", () => {
  it("accepts regular chat models", () => {
    expect(isChatCompletionModel("gpt-4o")).toBe(true);
    expect(isChatCompletionModel("anthropic/claude-sonnet-4-5")).toBe(true);
  });

  it("rejects embeddings, audio and image models", () => {
    expect(isChatCompletionModel("text-embedding-3-small")).toBe(false);
    expect(isChatCompletionModel("whisper-1")).toBe(false);
    expect(isChatCompletionModel("tts-1")).toBe(false);
    expect(isChatCompletionModel("dall-e-3")).toBe(false);
    expect(isChatCompletionModel("openai/gpt-image-1")).toBe(false);
    expect(isChatCompletionModel("omni-moderation-latest")).toBe(false);
    expect(isChatCompletionModel("cohere/rerank-english-v3")).toBe(false);
  });

  it("rejects OpenRouter dynamically-priced meta-routers", () => {
    expect(isChatCompletionModel("openrouter/auto")).toBe(false);
    expect(isChatCompletionModel("openrouter/auto-beta")).toBe(false);
    expect(isChatCompletionModel("openrouter/fusion")).toBe(false);
    expect(isChatCompletionModel("openrouter/pareto-code")).toBe(false);
    expect(isChatCompletionModel("openrouter/bodybuilder")).toBe(false);
  });
});
