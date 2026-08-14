import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, Message, ToolSpec } from "@ninjacode/providers";
import {
  compactHistory,
  compactHistoryLossless,
  isCompactionMessage,
  toolOutputLimit,
  truncateToolOutput,
} from "./context.js";
import { estimateContextUsage, estimateTokens } from "./contextEstimate.js";
import { isValidToolChain } from "./toolHistory.js";

describe("toolOutputLimit", () => {
  it("gives read_file a dedicated 40k budget", () => {
    expect(toolOutputLimit("read_file")).toBe(40_000);
    expect(toolOutputLimit("run_shell")).toBe(8_000);
    expect(toolOutputLimit()).toBe(8_000);
  });

  it("lets compactHistoryLossless keep a 20k read_file result intact", () => {
    const body = Array.from({ length: 400 }, (_, i) => `${i + 1}|${"x".repeat(50)}`).join("\n");
    expect(body.length).toBeGreaterThan(8_000);
    expect(body.length).toBeLessThan(40_000);
    const history: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "read_file", arguments: { path: "big.js" } }],
      },
      { role: "tool", name: "read_file", toolCallId: "c1", content: body },
    ];
    const result = compactHistoryLossless(history);
    expect(result[1]?.content).toBe(body);
  });

  it("still truncates oversized shell output at the default 8k cap", () => {
    const body = "line\n".repeat(3_000);
    const history: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "run_shell", arguments: { command: "cat" } }],
      },
      { role: "tool", name: "run_shell", toolCallId: "c1", content: body },
    ];
    const result = compactHistoryLossless(history);
    expect(result[1]?.content.length).toBeLessThan(body.length);
    expect(result[1]?.content).toContain("truncated");
  });

  it("truncateToolOutput prefers line boundaries", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}-xxxxxxxxxx`).join("\n");
    const out = truncateToolOutput(lines, 500);
    expect(out).toContain("truncated");
    // Every retained content line should be complete (no partial line- prefix).
    for (const part of out.split("\n\n…[truncated")[0]!.split("\n")) {
      if (part.length === 0) continue;
      expect(part.startsWith("line-")).toBe(true);
    }
  });
});

describe("estimateContextUsage", () => {
  const tools: ToolSpec[] = [
    { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
  ];

  it("breaks down system/history/tools without double-counting", () => {
    const system = "You are NinjaCode.";
    const history: Message[] = [
      { role: "user", content: "hello there" },
      { role: "assistant", content: "hi!" },
    ];

    const usage = estimateContextUsage({ system, history, tools, window: 128_000 });

    expect(usage.system).toBe(estimateTokens([{ role: "system", content: system }]));
    expect(usage.history).toBe(estimateTokens(history));
    expect(usage.tools).toBeGreaterThan(0);
    // total must be exactly the sum of the three disjoint buckets — no double counting.
    expect(usage.total).toBe(usage.system + usage.history + usage.tools);
    expect(usage.window).toBe(128_000);
  });

  it("tracks file-read tool output as an informational subset of history", () => {
    const history: Message[] = [
      { role: "user", content: "read foo.ts" },
      {
        role: "tool",
        name: "read_file",
        toolCallId: "call_1",
        content: "x".repeat(400),
      },
    ];
    const usage = estimateContextUsage({ system: "", history, window: 0 });
    expect(usage.files).toBeGreaterThan(0);
    expect(usage.files).toBeLessThanOrEqual(usage.history);
  });

  it("carries through cache stats and reserved output without affecting total", () => {
    const usage = estimateContextUsage({
      system: "sys",
      history: [],
      window: 1000,
      reservedOutput: 4096,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    });
    expect(usage.output).toBe(4096);
    expect(usage.cacheRead).toBe(10);
    expect(usage.cacheWrite).toBe(5);
    expect(usage.total).toBe(usage.system);
  });

  it("defaults window/output to 0 when unspecified", () => {
    const usage = estimateContextUsage({ system: "", history: [] });
    expect(usage.window).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.total).toBe(0);
  });
});

describe("compactHistory telemetry", () => {
  function bigHistory(n: number): Message[] {
    return Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
      content: `message number ${i} `.repeat(20),
    }));
  }

  it("does not fire onCompaction when history stays under the soft limit", async () => {
    let fired = false;
    const result = await compactHistory({
      history: bigHistory(5),
      onCompaction: () => {
        fired = true;
      },
    });
    expect(result.messages).toHaveLength(5);
    expect(result.changed).toBe(false);
    expect(fired).toBe(false);
  });

  it("fires onCompaction with before/after token estimates once the soft limit is exceeded", async () => {
    const events: Array<{ trigger: string; messagesSummarized: number }> = [];
    const result = await compactHistory({
      history: bigHistory(90),
      onCompaction: (info) => {
        events.push({ trigger: info.trigger, messagesSummarized: info.messagesSummarized });
        expect(info.tokensBefore).toBeGreaterThan(0);
        expect(info.tokensAfter).toBeGreaterThan(0);
        expect(info.tokensAfter).toBeLessThan(info.tokensBefore);
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.trigger).toBe("message_hard");
    expect(result.changed).toBe(true);
    expect(result.messages.some((m) => m.content.startsWith("[Compacted earlier conversation]"))).toBe(
      true,
    );
  });

  it("force-compacts on demand (manual /compact) even under the soft limit", async () => {
    // Under the default 40-message soft limit, but still large enough that
    // some messages fall outside the kept-recent tail once forced.
    let info: { trigger: string } | undefined;
    const result = await compactHistory({
      history: bigHistory(35),
      force: true,
      onCompaction: (i) => {
        info = i;
      },
    });
    expect(info?.trigger).toBe("manual");
    expect(result.changed).toBe(true);
    expect(result.messages.some((m) => m.content.startsWith("[Compacted earlier conversation]"))).toBe(
      true,
    );
  });
});

describe("compaction never recompresses its own output", () => {
  function historyWithSummary(n: number): Message[] {
    return [
      { role: "user", content: "[Compacted earlier conversation]\nEstablished: fix the parser bug." },
      ...Array.from({ length: n }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
        content: `message number ${i} `.repeat(20),
      })),
    ];
  }

  it("keeps an earlier summary verbatim through a second compaction", async () => {
    const result = await compactHistory({ history: historyWithSummary(90) });
    const summaries = result.messages.filter((m) => isCompactionMessage(m));

    expect(summaries.some((m) => m.content.includes("fix the parser bug"))).toBe(true);
    expect(summaries).toHaveLength(2);
  });

  it("orders the new summary after the one it does not cover", async () => {
    const result = await compactHistory({ history: historyWithSummary(90) });
    const first = result.messages.findIndex((m) => m.content.includes("fix the parser bug"));
    const second = result.messages.findIndex(
      (m) => isCompactionMessage(m) && !m.content.includes("fix the parser bug"),
    );

    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });
});

describe("lossless compaction pipeline", () => {
  /** Valid assistant → tool chains, the only shape the providers accept. */
  function shellTurns(count: number): Message[] {
    return Array.from({ length: count }, (_, i): Message[] => [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: `call_${i}`, name: "run_shell", arguments: { command: `echo ${i}` } }],
      },
      {
        role: "tool",
        name: "run_shell",
        toolCallId: `call_${i}`,
        content: `output ${i} `.repeat(100),
      },
    ]).flat();
  }

  it("leaves a merely long history untouched: masking would churn the cached prefix", () => {
    const history = shellTurns(14);

    const result = compactHistoryLossless(history);

    expect(result).toHaveLength(history.length);
    expect(result.map((m) => m.content)).toEqual(history.map((m) => m.content));
  });

  it("masks old observations once the context is under pressure, sparing the recent ones", async () => {
    const history = shellTurns(14);

    // A window this small puts the token estimate over the soft threshold.
    const result = await compactHistory({ history, contextWindow: 4_000 });

    expect(result.messages[1]?.content).toContain("output masked");
    expect(result.messages.at(-1)?.content).toBe(history.at(-1)?.content);
    expect(isValidToolChain(result.messages)).toBe(true);
  });

  it("takes no LLM call when masking alone relieves the pressure", async () => {
    const provider = { complete: vi.fn(), completeStreaming: vi.fn(), name: "unused" };

    await compactHistory({
      history: shellTurns(14),
      contextWindow: 4_000,
      provider: provider as unknown as LlmProvider,
    });

    expect(provider.completeStreaming).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });
});
