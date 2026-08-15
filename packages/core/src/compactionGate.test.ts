import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import {
  compactResult,
  computeCompactionLimits,
  resolveCompactionTrigger,
  shouldSkipCompaction,
} from "./compactionGate.js";

function msgs(n: number): Message[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as Message["role"],
    content: `m${i}`,
  }));
}

describe("computeCompactionLimits", () => {
  it("falls back to the hard message cap when no window is set", () => {
    const limits = computeCompactionLimits();
    expect(limits.hardLimit).toBe(80);
    expect(limits.tokenHighThreshold).toBe(0);
    expect(limits.tokenHardThreshold).toBe(0);
  });

  it("subtracts output and safety before deriving target and high thresholds", () => {
    const limits = computeCompactionLimits(500_000, { reservedOutputTokens: 20_000 });
    expect(limits.inputBudget).toBe(455_000);
    expect(limits.targetTokens).toBe(273_000);
    expect(limits.tokenHighThreshold).toBe(386_750);
    expect(limits.tokenHardThreshold).toBe(455_000);
  });

  it("keeps message count out of the gate when a token budget is known", () => {
    const limits = computeCompactionLimits(500_000);
    expect(limits.hardLimit).toBe(80);
    expect(limits.tokenHighThreshold).toBe(403_750);
    expect(limits.tokenHardThreshold).toBe(475_000);
  });
});

describe("shouldSkipCompaction", () => {
  it("skips until 80 messages when no window is set", () => {
    const limits = computeCompactionLimits();
    expect(shouldSkipCompaction(msgs(80), limits, {})).toBe(true);
    expect(shouldSkipCompaction(msgs(81), limits, {})).toBe(false);
  });

  it("skips a 100-message history under a 500k window (tokens still low)", () => {
    const limits = computeCompactionLimits(500_000);
    expect(shouldSkipCompaction(msgs(100), limits, { contextWindow: 500_000 })).toBe(true);
  });

  it("does not skip when forced", () => {
    const limits = computeCompactionLimits();
    expect(shouldSkipCompaction(msgs(5), limits, { force: true })).toBe(false);
  });
});

describe("resolveCompactionTrigger", () => {
  it("reports message_hard past 80 messages without a window", () => {
    const limits = computeCompactionLimits();
    expect(resolveCompactionTrigger(msgs(90), limits, {})).toBe("message_hard");
  });

  it("reports manual when forced", () => {
    const limits = computeCompactionLimits();
    expect(resolveCompactionTrigger(msgs(5), limits, { force: true })).toBe("manual");
  });

  it("skips retrigger after compaction lands near the 60% target", () => {
    const limits = computeCompactionLimits(8_000);
    const nearTarget: Message[] = [{ role: "user", content: "x".repeat(limits.targetTokens) }];
    expect(shouldSkipCompaction(nearTarget, limits, { contextWindow: 8_000 })).toBe(true);
    const overHigh: Message[] = [{ role: "user", content: "x".repeat(limits.tokenHighThreshold * 5) }];
    expect(shouldSkipCompaction(overHigh, limits, { contextWindow: 8_000 })).toBe(false);
  });

  it("keeps a tiny window from overflowing the input budget after compaction", () => {
    const limits = computeCompactionLimits(400, { reservedOutputTokens: 80 });
    expect(limits.inputBudget).toBeLessThan(400);
    expect(limits.targetTokens).toBe(Math.floor(limits.inputBudget * 0.6));
  });

  it("reports token_high when estimated tokens cross the high threshold", () => {
    const limits = computeCompactionLimits(4_000);
    const heavy: Message[] = [{ role: "user", content: "x".repeat(12_000) }];
    expect(resolveCompactionTrigger(heavy, limits, { contextWindow: 4_000 })).toBe("token_high");
  });
});

describe("compactResult", () => {
  it("marks unchanged content as not changed", () => {
    const history = msgs(3);
    expect(compactResult(history, [...history]).changed).toBe(false);
  });

  it("marks rewritten or summarized history as changed", () => {
    const history = msgs(3);
    const rewritten = history.map((m, i) => (i === 0 ? { ...m, content: "edited" } : m));
    expect(compactResult(history, rewritten).changed).toBe(true);
    expect(compactResult(history, history, true).changed).toBe(true);
  });
});
