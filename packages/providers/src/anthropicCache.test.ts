import { describe, expect, it } from "vitest";
import {
  applyAnthropicCacheBreakpoints,
  type AnthropicCacheablePayload,
} from "./anthropicCache.js";

const EPHEMERAL = { type: "ephemeral" };

describe("applyAnthropicCacheBreakpoints", () => {
  it("converts a string system prompt into a cached text block", () => {
    const body = applyAnthropicCacheBreakpoints({ system: "you are helpful" });
    expect(body.system).toEqual([
      { type: "text", text: "you are helpful", cache_control: EPHEMERAL },
    ]);
  });

  it("marks the last tool definition", () => {
    const body = applyAnthropicCacheBreakpoints({
      tools: [{ name: "a" }, { name: "b" }, { name: "c" }],
    });
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools[0]!.cache_control).toBeUndefined();
    expect(tools[2]!.cache_control).toEqual(EPHEMERAL);
  });

  it("marks a compacted summary but not the volatile tail", () => {
    const body = applyAnthropicCacheBreakpoints({
      messages: [
        { role: "user", content: "[Compacted earlier conversation]\nstable summary" },
        { role: "user", content: "[Workspace state delta]\nvolatile" },
      ],
    });
    const msgs = body.messages as Array<Record<string, unknown>>;
    expect(msgs[0]!.content).toEqual([
      {
        type: "text",
        text: "[Compacted earlier conversation]\nstable summary",
        cache_control: EPHEMERAL,
      },
    ]);
    expect(msgs[1]!.content).toBe("[Workspace state delta]\nvolatile");
  });

  it("marks the summary block when merged user content is an array", () => {
    const body = applyAnthropicCacheBreakpoints({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "[Compacted earlier conversation]\nsummary" },
            { type: "text", text: "[Workspace state delta]\nvolatile" },
          ],
        },
      ],
    });
    const blocks = (body.messages as Array<Record<string, unknown>>)[0]!.content as Array<
      Record<string, unknown>
    >;
    expect(blocks[0]!.cache_control).toEqual(EPHEMERAL);
    expect(blocks[1]!.cache_control).toBeUndefined();
  });

  it("is a no-op on empty sections", () => {
    const body = applyAnthropicCacheBreakpoints({ system: "", tools: [], messages: [] });
    expect(body.system).toBe("");
    expect(body.tools).toEqual([]);
    expect(body.messages).toEqual([]);
  });

  it("respects the 4-breakpoint limit (system + tool + message = 3)", () => {
    const input: AnthropicCacheablePayload = {
      system: "sys",
      tools: [{ name: "only" }],
      messages: [{ role: "user", content: "[Compacted earlier conversation]\nsummary" }],
    };
    const body = applyAnthropicCacheBreakpoints(input);
    let count = 0;
    const sys = body.system as Array<Record<string, unknown>>;
    if (sys.some((b) => b.cache_control)) count++;
    const tools = body.tools as Array<Record<string, unknown>>;
    if (tools.some((t) => t.cache_control)) count++;
    const lastMsg = (body.messages as Array<Record<string, unknown>>)[0]!.content as Array<
      Record<string, unknown>
    >;
    if (lastMsg.some((b) => b.cache_control)) count++;
    expect(count).toBe(3);
    expect(count).toBeLessThanOrEqual(4);
  });
});
