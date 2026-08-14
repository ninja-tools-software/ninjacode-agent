import { describe, expect, it } from "vitest";
import type { ContextUsage } from "../types.js";
import { computeBreakdown, rowPercent, usageLevel } from "./contextBreakdown.js";

const usage = (over: Partial<ContextUsage> = {}): ContextUsage => ({
  system: 1_000,
  history: 5_000,
  tools: 2_000,
  output: 2_000,
  files: 0,
  total: 10_000,
  window: 100_000,
  ...over,
});

describe("usageLevel", () => {
  it("escalates at 70% and 90%", () => {
    expect(usageLevel(0)).toBe("ok");
    expect(usageLevel(69.9)).toBe("ok");
    expect(usageLevel(70)).toBe("warn");
    expect(usageLevel(89.9)).toBe("warn");
    expect(usageLevel(90)).toBe("danger");
  });
});

describe("rowPercent", () => {
  it("is a clamped share of the window", () => {
    expect(rowPercent(2_500, 10_000)).toBe(25);
    expect(rowPercent(20_000, 10_000)).toBe(100);
  });

  it("returns zero rather than NaN or Infinity", () => {
    expect(rowPercent(100, 0)).toBe(0);
    expect(rowPercent(0, 10_000)).toBe(0);
  });
});

describe("computeBreakdown", () => {
  it("counts composer badges towards the projection", () => {
    const b = computeBreakdown(usage(), 5_000);
    expect(b.projected).toBe(15_000);
    expect(b.pct).toBeCloseTo(15);
    expect(b.freeTokens).toBe(85_000);
  });

  it("adds an attached row only when badges are pending", () => {
    expect(computeBreakdown(usage()).rows.map((r) => r.key)).toEqual([
      "system",
      "history",
      "tools",
      "output",
    ]);
    expect(computeBreakdown(usage(), 10).rows.at(-1)?.key).toBe("attached");
  });

  it("mentions the file share of history when there is one", () => {
    expect(computeBreakdown(usage({ files: 2_400 })).rows[1]!.detail).toBe("2.4K");
    expect(computeBreakdown(usage()).rows[1]!.detail).toBeUndefined();
  });

  it("clamps an overflowing projection instead of reporting negative free space", () => {
    const b = computeBreakdown(usage({ total: 99_000 }), 5_000);
    expect(b.pct).toBe(100);
    expect(b.level).toBe("danger");
    expect(b.freeTokens).toBe(0);
  });

  it("stays at zero percent when the window is unknown", () => {
    const b = computeBreakdown(usage({ window: 0 }), 0);
    expect(b.pct).toBe(0);
    expect(b.level).toBe("ok");
  });
});
