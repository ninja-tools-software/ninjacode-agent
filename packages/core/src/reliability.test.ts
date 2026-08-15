import { describe, expect, it } from "vitest";
import type { Completion, CompletionRequest, LlmProvider, StreamSink } from "@ninjacode/providers";
import { GatewayError, LlmError } from "@ninjacode/providers";
import { BudgetTracker, ToolCircuitBreaker, withRetry } from "./reliability.js";
import type { Clock } from "./ports.js";

class FlakyProvider implements LlmProvider {
  readonly name = "flaky";
  readonly attempts: unknown[] = [];

  constructor(
    private readonly errors: unknown[],
    private readonly success: Completion = {
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      model: "mock",
      stopReason: "end",
    },
  ) {}

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(_req: CompletionRequest): Promise<Completion> {
    const err = this.errors[this.attempts.length];
    this.attempts.push(err ?? "success");
    if (err !== undefined) throw err;
    return this.success;
  }
}

/** Fails the first attempt, optionally after streaming a few deltas first. */
class PartialStreamProvider implements LlmProvider {
  readonly name = "partial-stream";
  attempts = 0;

  constructor(private readonly opts: { deltasBeforeError: number }) {}

  async complete(req: CompletionRequest): Promise<Completion> {
    return this.completeStreaming(req);
  }

  async completeStreaming(_req: CompletionRequest, sink?: StreamSink): Promise<Completion> {
    this.attempts += 1;
    const failing = this.attempts === 1;
    const chunks = failing ? ["par", "tial"].slice(0, this.opts.deltasBeforeError) : ["full ", "answer"];
    for (const text of chunks) await sink?.({ type: "text_delta", text });
    if (failing) throw new LlmError("server error", 503, "test");
    return {
      text: "full answer",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 2 },
      model: "mock",
      stopReason: "end",
    };
  }
}

describe("withRetry", () => {
  it("retries on 429 and 5xx then succeeds", async () => {
    const inner = new FlakyProvider([
      new LlmError("rate limited", 429, "test"),
      new LlmError("server error", 503, "test"),
    ]);
    const provider = withRetry(inner, {
      maxRetries: 3,
      baseDelayMs: 1,
      sleep: async () => undefined,
    });

    const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("ok");
    expect(inner.attempts).toHaveLength(3);
  });

  it("stops immediately on non-retryable errors", async () => {
    const inner = new FlakyProvider([new LlmError("bad request", 400, "test")]);
    const provider = withRetry(inner, {
      maxRetries: 4,
      sleep: async () => undefined,
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(inner.attempts).toHaveLength(1);
  });

  it("does not retry a terminal GatewayError even on HTTP 503", async () => {
    const inner = new FlakyProvider([
      new GatewayError("model_not_priced", "model_not_priced: claude-opus-4", {
        status: 503,
        model: "claude-opus-4",
      }),
    ]);
    const provider = withRetry(inner, {
      maxRetries: 4,
      sleep: async () => undefined,
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: "model_not_priced", status: 503 });
    expect(inner.attempts).toHaveLength(1);
  });

  it("retries a non-terminal GatewayError (rate_limited)", async () => {
    const inner = new FlakyProvider([
      new GatewayError("rate_limited", "rate_limited", { status: 429 }),
    ]);
    const provider = withRetry(inner, {
      maxRetries: 3,
      sleep: async () => undefined,
    });

    const result = await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("ok");
    expect(inner.attempts).toHaveLength(2);
  });

  it("uses clock-driven jitter without real delays", async () => {
    let now = 100;
    const clock: Clock = { now: () => now };
    const inner = new FlakyProvider([new LlmError("rate limited", 429, "test")]);
    const slept: number[] = [];
    const provider = withRetry(inner, {
      maxRetries: 1,
      baseDelayMs: 100,
      clock,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    await provider.complete({ messages: [{ role: "user", content: "hi" }] });
    now = 250;
    const provider2 = withRetry(new FlakyProvider([new LlmError("rate limited", 429, "test")]), {
      maxRetries: 1,
      baseDelayMs: 100,
      clock,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await provider2.complete({ messages: [{ role: "user", content: "hi" }] });

    expect(slept.length).toBeGreaterThanOrEqual(2);
    expect(slept[0]).not.toBe(slept[1]);
  });

  it("retries a stream that failed before emitting anything", async () => {
    const inner = new PartialStreamProvider({ deltasBeforeError: 0 });
    const provider = withRetry(inner, { maxRetries: 2, sleep: async () => undefined });

    const received: string[] = [];
    const result = await provider.completeStreaming(
      { messages: [{ role: "user", content: "hi" }] },
      async (event) => {
        if (event.type === "text_delta") received.push(event.text);
      },
    );

    expect(result.text).toBe("full answer");
    expect(inner.attempts).toBe(2);
    expect(received.join("")).toBe("full answer");
  });

  it("does not retry once deltas already reached the sink", async () => {
    const inner = new PartialStreamProvider({ deltasBeforeError: 2 });
    const provider = withRetry(inner, { maxRetries: 2, sleep: async () => undefined });

    const received: string[] = [];
    await expect(
      provider.completeStreaming({ messages: [{ role: "user", content: "hi" }] }, async (event) => {
        if (event.type === "text_delta") received.push(event.text);
      }),
    ).rejects.toMatchObject({ status: 503 });

    // One attempt only: replaying would show the user the same prefix twice.
    expect(inner.attempts).toBe(1);
    expect(received).toEqual(["par", "tial"]);
  });
});

describe("ToolCircuitBreaker", () => {
  it("opens after three consecutive failures", () => {
    const breaker = new ToolCircuitBreaker(3);
    expect(breaker.isOpen("run_shell")).toBe(false);

    breaker.recordFailure("run_shell");
    breaker.recordFailure("run_shell");
    expect(breaker.isOpen("run_shell")).toBe(false);

    breaker.recordFailure("run_shell");
    expect(breaker.isOpen("run_shell")).toBe(true);
    expect(breaker.disabledTools()).toEqual(["run_shell"]);
  });

  it("resets a tool after success", () => {
    const breaker = new ToolCircuitBreaker(3);
    breaker.recordFailure("read_file");
    breaker.recordFailure("read_file");
    breaker.recordSuccess("read_file");
    breaker.recordFailure("read_file");
    expect(breaker.isOpen("read_file")).toBe(false);
  });

  it("half-opens after the cooldown so a transient cause is retried", () => {
    let now = 0;
    const breaker = new ToolCircuitBreaker(3, { clock: { now: () => now }, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure("run_shell");
    expect(breaker.isOpen("run_shell")).toBe(true);

    now = 1001;
    expect(breaker.isOpen("run_shell")).toBe(false);
    expect(breaker.disabledTools()).toEqual([]);
  });

  it("re-opens for another cooldown when the probe fails again", () => {
    let now = 0;
    const breaker = new ToolCircuitBreaker(3, { clock: { now: () => now }, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure("run_shell");

    now = 1001;
    expect(breaker.isOpen("run_shell")).toBe(false);
    breaker.recordFailure("run_shell");
    expect(breaker.isOpen("run_shell")).toBe(true);

    now = 2500;
    expect(breaker.isOpen("run_shell")).toBe(false);
  });

  it("closes for good when the probe succeeds", () => {
    let now = 0;
    const breaker = new ToolCircuitBreaker(3, { clock: { now: () => now }, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure("run_shell");

    now = 1001;
    breaker.isOpen("run_shell");
    breaker.recordSuccess("run_shell");
    breaker.recordFailure("run_shell");
    expect(breaker.isOpen("run_shell")).toBe(false);
  });

  it("does not consume the probe just by listing disabled tools", () => {
    let now = 0;
    const breaker = new ToolCircuitBreaker(3, { clock: { now: () => now }, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure("run_shell");

    now = 1001;
    breaker.disabledTools();
    breaker.recordFailure("run_shell");
    // The failure must count as a fresh strike, not a failed probe.
    expect(breaker.isOpen("run_shell")).toBe(true);
  });
});

describe("BudgetTracker", () => {
  it("reports exceeded input token budget", () => {
    const tracker = new BudgetTracker({ maxInputTokens: 100 });
    tracker.add({ inputTokens: 60, outputTokens: 0 });
    expect(tracker.check()).toEqual({ ok: true });

    tracker.add({ inputTokens: 50, outputTokens: 0 });
    const result = tracker.check();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("input token budget exceeded");
  });

  it("reports exceeded cost budget", () => {
    const tracker = new BudgetTracker({ maxCostUsd: 0.001 }, { input: 3, output: 15 });
    tracker.add({ inputTokens: 500_000, outputTokens: 0 });
    const result = tracker.check();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("cost budget exceeded");
  });

  it("falls back to Anthropic cache ratios when the price table omits them", () => {
    const read = new BudgetTracker({}, { input: 3, output: 15 });
    read.add({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 1e6 });
    expect(read.estimatedCostUsd).toBeCloseTo(0.3);

    const write = new BudgetTracker({}, { input: 3, output: 15 });
    write.add({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1e6 });
    expect(write.estimatedCostUsd).toBeCloseTo(3.75);
  });

  it("uses the published cache price when the table provides one", () => {
    const tracker = new BudgetTracker({}, { input: 0.14, output: 0.28, cacheRead: 0.014 });
    tracker.add({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 10e6 });
    expect(tracker.estimatedCostUsd).toBeCloseTo(0.14 + 0.28 + 0.14);
  });

  it("keeps charging for uncached input when cache reads dominate", () => {
    const tracker = new BudgetTracker({}, { input: 3, output: 15 });
    tracker.add({ inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 10e6 });
    // Uncached input must still cost $3 — never cancelled out by cache reads.
    expect(tracker.estimatedCostUsd).toBeCloseTo(3 + 3);
  });

  it("accounts for compaction in totals and in a separate bucket", () => {
    const tracker = new BudgetTracker({}, { input: 1, output: 2 });
    tracker.add(
      { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 50 },
      { category: "compaction", pricing: { input: 2, output: 4 } },
    );
    const snapshot = tracker.snapshot();
    expect(snapshot.inputTokens).toBe(1_000);
    expect(snapshot.compaction.inputTokens).toBe(1_000);
    expect(snapshot.compaction.outputTokens).toBe(100);
    expect(snapshot.compaction.cacheReadTokens).toBe(50);
    expect(snapshot.compaction.estimatedCostUsd).toBeGreaterThan(0);
    expect(snapshot.compaction.count).toBe(1);
  });

  it("records compaction model and duration separately", () => {
    const tracker = new BudgetTracker({}, { input: 1, output: 2 });
    tracker.add(
      { inputTokens: 10, outputTokens: 4 },
      { category: "compaction", model: "utility", durationMs: 25 },
    );
    expect(tracker.snapshot().compaction.model).toBe("utility");
    expect(tracker.snapshot().compaction.durationMs).toBe(25);
  });
});
