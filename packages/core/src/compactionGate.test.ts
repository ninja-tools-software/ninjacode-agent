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
  it("falls back to 40/80 messages when no window is set", () => {
    const limits = computeCompactionLimits();
    expect(limits.softLimit).toBe(40);
    expect(limits.hardLimit).toBe(80);
    expect(limits.tokenSoftThreshold).toBe(0);
    expect(limits.tokenHardThreshold).toBe(0);
  });

  it("scales message and token thresholds from a 500k window", () => {
    const limits = computeCompactionLimits(500_000);
    expect(limits.softLimit).toBe(400);
    expect(limits.hardLimit).toBe(410);
    expect(limits.tokenSoftThreshold).toBe(360_000);
    expect(limits.tokenHardThreshold).toBe(425_000);
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

  it("reports token_soft when estimated tokens cross the soft threshold", () => {
    const limits = computeCompactionLimits(4_000);
    const heavy: Message[] = [{ role: "user", content: "x".repeat(12_000) }];
    expect(resolveCompactionTrigger(heavy, limits, { contextWindow: 4_000 })).toBe("token_soft");
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
