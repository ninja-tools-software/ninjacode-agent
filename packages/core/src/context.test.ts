import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, Message, ToolSpec } from "@ninjacode/providers";
import { findModelAnywhere } from "@ninjacode/providers";
import {
  compactHistory,
  compactHistoryLossless,
  compactionTranscriptBudget,
  isCompactionMessage,
  toolOutputLimit,
  truncateToolOutput,
} from "./context.js";
import { CHECKPOINT_INSTRUCTIONS } from "./compactionCheckpoint.js";
import {
  clampMaxTokens,
  contextSafetyMargin,
  estimateContextUsage,
  estimateImageTokens,
  estimateTokens,
  recordTokenCalibration,
  tokenCalibrationMultiplier,
} from "./contextEstimate.js";
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

  it("uses the shared 5% safety margin (floor 512)", () => {
    expect(contextSafetyMargin(0)).toBe(0);
    expect(contextSafetyMargin(200_000)).toBe(10_000);
    expect(contextSafetyMargin(1_000_000)).toBe(50_000);
    expect(contextSafetyMargin(1_000)).toBe(512);
  });

  it("calibrates per resolved model and never becomes optimistic", () => {
    const model = "calibration-test-model";
    expect(tokenCalibrationMultiplier(model)).toBeGreaterThanOrEqual(1);
    recordTokenCalibration(model, 100, 150);
    expect(tokenCalibrationMultiplier(model)).toBeGreaterThanOrEqual(1.5);
    recordTokenCalibration(model, 100, 50);
    expect(tokenCalibrationMultiplier(model)).toBeGreaterThanOrEqual(1);
  });
});

describe("image token estimation", () => {
  const image = (chars: number): Message => ({
    role: "user",
    content: "look",
    parts: [{ type: "image", mimeType: "image/png", data: "a".repeat(chars) }],
  });

  it("counts attached images instead of treating them as free", () => {
    const withImage = estimateTokens([image(1_400_000)]);
    const textOnly = estimateTokens([{ role: "user", content: "look" }]);
    expect(withImage).toBeGreaterThan(textOnly + 1_000);
  });

  it("charges a floor even for a tiny image", () => {
    expect(estimateImageTokens([{ type: "image", mimeType: "image/png", data: "aa" }])).toBe(256);
  });

  it("returns zero when a message has no parts", () => {
    expect(estimateImageTokens(undefined)).toBe(0);
    expect(estimateImageTokens([])).toBe(0);
  });

  it("reports images as their own line in the breakdown", () => {
    const usage = estimateContextUsage({ system: "s", history: [image(500_000)] });
    expect(usage.images).toBeGreaterThan(0);
    expect(usage.total).toBeGreaterThan(usage.images);
  });

  it("leaves the breakdown image line at zero for text-only history", () => {
    const usage = estimateContextUsage({
      system: "s",
      history: [{ role: "user", content: "hello" }],
    });
    expect(usage.images).toBe(0);
  });
});

describe("clampMaxTokens", () => {
  it("leaves room for input when maxOutput exceeds the default DeepSeek window", () => {
    expect(clampMaxTokens(384_000, 200_000)).toBe(157_232);
  });

  it("keeps the full DeepSeek maxOutput on a 1M window", () => {
    expect(clampMaxTokens(384_000, 1_000_000)).toBe(384_000);
  });

  it("does not reduce Claude-sized maxOutput on a 200k window", () => {
    expect(clampMaxTokens(64_000, 200_000)).toBe(64_000);
  });

  it("passes through maxTokens when the window is unknown", () => {
    expect(clampMaxTokens(384_000)).toBe(384_000);
    expect(clampMaxTokens(384_000, 0)).toBe(384_000);
  });

  it("leaves enough input budget for a first agent turn on DeepSeek defaults", () => {
    const maxTokens = clampMaxTokens(384_000, 200_000);
    const usage = estimateContextUsage({
      system: "You are NinjaCode.",
      history: [{ role: "user", content: "hello" }],
      window: 200_000,
      reservedOutput: maxTokens,
    });
    expect(usage.inputBudget).toBe(32_768);
    expect(usage.inputBudget).toBeGreaterThan(usage.total);
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

  it("names the reason when the summarizer fails instead of silently degrading", async () => {
    const provider: LlmProvider = {
      name: "broken",
      async complete() {
        throw new Error("prompt is too long: 250000 tokens > 200000 maximum");
      },
      async completeStreaming() {
        throw new Error("unused");
      },
    };
    let info: { fallback: boolean; fallbackReason?: string; model: string } | undefined;

    await compactHistory({
      history: bigHistory(90),
      provider,
      model: "claude-sonnet-4-20250514",
      onCompaction: (i) => {
        info = i;
      },
    });

    expect(info?.fallback).toBe(true);
    expect(info?.fallbackReason).toContain("prompt is too long");
  });

  it("reports no fallback reason when the summarizer answers", async () => {
    const provider: LlmProvider = {
      name: "summarizer",
      async complete() {
        return {
          text: "## Objective\nShip it.",
          toolCalls: [],
          usage: { inputTokens: 5, outputTokens: 5 },
          model: "summarizer",
          stopReason: "end" as const,
        };
      },
      async completeStreaming() {
        throw new Error("unused");
      },
    };
    let info: { fallback: boolean; fallbackReason?: string } | undefined;

    await compactHistory({
      history: bigHistory(90),
      provider,
      onCompaction: (i) => {
        info = i;
      },
    });

    expect(info?.fallback).toBe(false);
    expect(info?.fallbackReason).toBeUndefined();
  });
});

describe("compactionTranscriptBudget", () => {
  it("leaves room for the checkpoint instructions and the summary itself", () => {
    const budget = compactionTranscriptBudget("claude-sonnet-4-20250514");
    const window = findModelAnywhere("claude-sonnet-4-20250514")!.contextWindow;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(window * 0.9);
  });

  it("falls back to a conservative window for an unknown summarizer", () => {
    expect(compactionTranscriptBudget("some-unlisted-model")).toBe(
      compactionTranscriptBudget(undefined),
    );
  });

  it("never returns a budget too small to send anything", () => {
    expect(compactionTranscriptBudget("gpt-4o")).toBeGreaterThanOrEqual(1_000);
  });
});

describe("summarizer transcript bounding", () => {
  function hugeHistory(n: number, charsEach: number): Message[] {
    return Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
      content: `m${i} ${"x".repeat(charsEach)}`,
    }));
  }

  /**
   * The regression: a transcript larger than the summarizer's own window used to
   * be sent as-is, come back as a provider error, and land in the heuristic
   * fallback with no trace.
   */
  it("trims an oversized transcript instead of letting the call fail", async () => {
    let requestChars = 0;
    const provider: LlmProvider = {
      name: "small-window",
      async complete(request) {
        requestChars = request.messages.reduce((total, m) => total + m.content.length, 0);
        return {
          text: "## Objective\nDone.",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "small-window",
          stopReason: "end" as const,
        };
      },
      async completeStreaming() {
        throw new Error("unused");
      },
    };
    let info: { fallback: boolean; droppedFromTranscript: number } | undefined;

    await compactHistory({
      history: hugeHistory(120, 20_000),
      provider,
      model: "gpt-4o",
      onCompaction: (i) => {
        info = i;
      },
    });

    const budget = compactionTranscriptBudget("gpt-4o");
    expect(info?.fallback).toBe(false);
    expect(info?.droppedFromTranscript).toBeGreaterThan(0);
    expect(requestChars).toBeLessThanOrEqual(budget * 4 + CHECKPOINT_INSTRUCTIONS.length + 4_000);
  });

  it("keeps the prior canonical checkpoint even when trimming", async () => {
    let transcript = "";
    const provider: LlmProvider = {
      name: "small-window",
      async complete(request) {
        transcript = request.messages.at(-1)!.content;
        return {
          text: "## Objective\nDone.",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "small-window",
          stopReason: "end" as const,
        };
      },
      async completeStreaming() {
        throw new Error("unused");
      },
    };

    await compactHistory({
      history: [
        { role: "user", content: "[Compacted earlier conversation]\n## Objective\nKEEP_THIS_MARKER" },
        ...hugeHistory(120, 20_000),
      ],
      provider,
      model: "gpt-4o",
      force: true,
    });

    expect(transcript).toContain("KEEP_THIS_MARKER");
    expect(transcript).toContain("older message(s) omitted");
  });

  it("sends the whole transcript when it comfortably fits", async () => {
    let transcript = "";
    const provider: LlmProvider = {
      name: "big-window",
      async complete(request) {
        transcript = request.messages.at(-1)!.content;
        return {
          text: "## Objective\nDone.",
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          model: "big-window",
          stopReason: "end" as const,
        };
      },
      async completeStreaming() {
        throw new Error("unused");
      },
    };
    let info: { droppedFromTranscript: number } | undefined;

    await compactHistory({
      history: hugeHistory(90, 50),
      provider,
      model: "gpt-4o",
      onCompaction: (i) => {
        info = i;
      },
    });

    expect(info?.droppedFromTranscript).toBe(0);
    expect(transcript).not.toContain("omitted");
  });
});

describe("canonical compaction summary", () => {
  function historyWithSummary(n: number): Message[] {
    return [
      { role: "user", content: "[Compacted earlier conversation]\nEstablished: fix the parser bug." },
      ...Array.from({ length: n }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
        content: `message number ${i} `.repeat(20),
      })),
    ];
  }

  it("replaces an earlier summary instead of stacking another one", async () => {
    const result = await compactHistory({ history: historyWithSummary(90) });
    const summaries = result.messages.filter((m) => isCompactionMessage(m));

    expect(summaries.some((m) => m.content.includes("fix the parser bug"))).toBe(true);
    expect(summaries).toHaveLength(1);
  });

  it("still has exactly one summary after ten cycles", async () => {
    let history = historyWithSummary(90);
    for (let cycle = 0; cycle < 10; cycle += 1) {
      history.push(
        ...Array.from({ length: 90 }, (_, index): Message => ({
          role: index % 2 === 0 ? "user" : "assistant",
          content: `cycle ${cycle} message ${index} `.repeat(20),
        })),
      );
      history = (await compactHistory({ history })).messages;
      expect(history.filter(isCompactionMessage)).toHaveLength(1);
    }
  });

  it("recovers structured decisions and archive references across compactions", async () => {
    const artifactId = "a".repeat(64);
    const complete = vi
      .fn<LlmProvider["complete"]>()
      .mockResolvedValueOnce({
        text: [
          "## Objective\nShip the parser fix",
          "## Constraints\n- Keep compatibility",
          "## Decisions\n- Use a streaming parser",
          "## Files\n- src/parser.ts",
          "## Tests\n- pnpm test parser",
          "## Errors\nNone",
          "## Next action\nImplement parser",
          "## Recovery\nNone",
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 40 },
        model: "utility",
        stopReason: "end",
      })
      .mockResolvedValueOnce({
        text: [
          "## Objective\nShip the parser fix",
          "## Constraints\nNone",
          "## Decisions\n- Add recovery coverage",
          "## Files\n- src/parser.test.ts",
          "## Tests\nNone",
          "## Errors\n- flaky fixture",
          "## Next action\nRun typecheck",
          "## Recovery\nNone",
        ].join("\n"),
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 40 },
        model: "utility",
        stopReason: "end",
      });
    const provider = { name: "test", complete, completeStreaming: vi.fn() } satisfies LlmProvider;
    let history: Message[] = [
      { role: "user", content: `Inspect archived artifact ${artifactId}` },
      ...Array.from({ length: 90 }, (_, i): Message => ({
        role: i % 2 === 0 ? "assistant" : "user",
        content: `first cycle ${i}`,
      })),
    ];

    history = (
      await compactHistory({
        history,
        provider,
        pinnedTask: "Ship the parser fix",
        recoveryReferences: { history: "session-events.ndjson" },
      })
    ).messages;
    history.push(
      ...Array.from({ length: 90 }, (_, i): Message => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `second cycle ${i}`,
      })),
    );
    history = (await compactHistory({ history, provider, pinnedTask: "Ship the parser fix" }))
      .messages;
    const checkpoint = history.find(isCompactionMessage)?.content ?? "";

    expect(checkpoint).toContain("## Objective");
    expect(checkpoint).toContain("Use a streaming parser");
    expect(checkpoint).toContain("Add recovery coverage");
    expect(checkpoint).toContain("session-events.ndjson");
    expect(checkpoint).toContain(artifactId);
    expect(checkpoint).toContain("## Errors");
    expect(checkpoint).toContain("## Next action");
    expect(history.filter(isCompactionMessage)).toHaveLength(1);
  });

  it("sends the actual beginning, middle and end of the compacted segment to the model", async () => {
    const complete = vi.fn(async (_request: Parameters<LlmProvider["complete"]>[0]) => ({
      text: [
        "## Task\nBEGIN_SENTINEL",
        "## Constraints\nMIDDLE_SENTINEL",
        "## Files touched\nNone",
        "## Decisions\nEND_SENTINEL",
        "## Validation\nNone",
        "## Open work\nNone",
        "## Archives\nNone",
      ].join("\n"),
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 20 },
      model: "utility-model",
      stopReason: "end" as const,
    }));
    const provider = {
      name: "test",
      complete,
      completeStreaming: vi.fn(),
    } satisfies LlmProvider;
    const history = Array.from({ length: 90 }, (_, index): Message => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content:
        index === 0
          ? "BEGIN_SENTINEL"
          : index === 30
            ? "MIDDLE_SENTINEL"
            : index === 59
              ? "END_SENTINEL"
              : `message ${index}`,
    }));

    await compactHistory({ history, provider, model: "utility-model" });

    const segment = complete.mock.calls[0]?.[0].messages.at(-1)?.content ?? "";
    expect(segment).toContain("BEGIN_SENTINEL");
    expect(segment).toContain("MIDDLE_SENTINEL");
    expect(segment).toContain("END_SENTINEL");
  });

  it("returns near the 60% target and stays below the complete input budget", async () => {
    const provider = {
      name: "test",
      complete: vi.fn(async () => ({
        text: "## Task\nContinue\n## Constraints\nNone\n## Files touched\nNone\n## Decisions\nNone\n## Validation\nNone\n## Open work\nContinue\n## Archives\nNone",
        toolCalls: [],
        usage: { inputTokens: 1_000, outputTokens: 50 },
        model: "utility",
        stopReason: "end" as const,
      })),
      completeStreaming: vi.fn(),
    } satisfies LlmProvider;
    const history = Array.from({ length: 100 }, (_, index): Message => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}-${"x".repeat(500)}`,
    }));

    const result = await compactHistory({
      history,
      provider,
      contextWindow: 12_000,
      reservedOutputTokens: 2_000,
      model: "utility",
      budgetModel: "primary",
    });
    const inputBudget = 12_000 - 2_000 - 600;
    expect(estimateTokens(result.messages, "primary")).toBeLessThanOrEqual(
      Math.floor(inputBudget * 0.6),
    );
  });

  it("falls back locally on provider failure but propagates abort", async () => {
    const provider = {
      name: "failing",
      complete: vi.fn(async () => {
        throw new Error("provider down");
      }),
      completeStreaming: vi.fn(),
    } satisfies LlmProvider;
    let fallback = false;
    const result = await compactHistory({
      history: historyWithSummary(90),
      provider,
      onCompaction: (info) => {
        fallback = info.fallback;
      },
    });
    expect(fallback).toBe(true);
    expect(result.messages.filter(isCompactionMessage)).toHaveLength(1);

    const controller = new AbortController();
    controller.abort("stop");
    await expect(
      compactHistory({
        history: historyWithSummary(90),
        provider,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses provider-native compaction when available", async () => {
    const compactContext = vi.fn(async () => ({
      text: "## Task\nNative\n## Constraints\nNone\n## Files touched\nNone\n## Decisions\nNone\n## Validation\nNone\n## Open work\nNone\n## Archives\nNone",
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      model: "native-model",
      stopReason: "end" as const,
    }));
    const provider: LlmProvider = {
      name: "native",
      compactContext,
      complete: vi.fn(async () => {
        throw new Error("portable path should not run");
      }),
      completeStreaming: vi.fn(),
    };

    await compactHistory({ history: historyWithSummary(90), provider });
    expect(compactContext).toHaveBeenCalledOnce();
    expect(provider.complete).not.toHaveBeenCalled();
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

  function readTurns(count: number): Message[] {
    return Array.from({ length: count }, (_, i): Message[] => [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: `read_${i}`, name: "read_file", arguments: { path: `file-${i}` } }],
      },
      {
        role: "tool",
        name: "read_file",
        toolCallId: `read_${i}`,
        content:
          `output ${i} `.repeat(100) +
          `\n[archived as artifact ${String(i).padStart(64, "0")}]`,
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
    const history = readTurns(15);

    // A window this small puts the token estimate over the soft threshold.
    const result = await compactHistory({ history, contextWindow: 5_000 });

    expect(result.messages.some((message) => message.content.includes("output masked"))).toBe(true);
    expect(result.messages.at(-1)?.content).toBe(history.at(-1)?.content);
    expect(isValidToolChain(result.messages)).toBe(true);
  });

  it("takes no LLM call when masking alone relieves the pressure", async () => {
    const provider = { complete: vi.fn(), completeStreaming: vi.fn(), name: "unused" };

    await compactHistory({
      history: readTurns(15),
      contextWindow: 5_000,
      provider: provider as unknown as LlmProvider,
    });

    expect(provider.completeStreaming).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it("keeps complete tool-call chains through repeated compactions", async () => {
    let history = shellTurns(50);
    history = (await compactHistory({ history })).messages;
    history.push(...shellTurns(50));
    history = (await compactHistory({ history })).messages;

    expect(history.filter(isCompactionMessage)).toHaveLength(1);
    expect(isValidToolChain(history)).toBe(true);
  });

  it("keeps contradictory constraints visible to the compressor", async () => {
    const complete = vi.fn(async (request: Parameters<LlmProvider["complete"]>[0]) => {
      const prompt = JSON.stringify(request.messages);
      expect(prompt).toContain("must use tabs");
      expect(prompt).toContain("must use spaces");
      return {
        text: "## Task\nformat\n## Constraints\nmust use tabs; must use spaces\n## Files touched\nNone\n## Decisions\nNone\n## Validation\nNone\n## Open work\nNone\n## Archives\nNone",
        toolCalls: [],
        usage: { inputTokens: 20, outputTokens: 10 },
        model: "utility",
        stopReason: "end" as const,
      };
    });
    await compactHistory({
      history: [
        { role: "user", content: "must use tabs" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "must use spaces" },
        ...Array.from({ length: 80 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
          content: `pad ${i} `.repeat(30),
        })),
      ],
      provider: { name: "test", complete, completeStreaming: vi.fn() },
      contextWindow: 4_000,
    });
    expect(complete).toHaveBeenCalled();
  });
});
