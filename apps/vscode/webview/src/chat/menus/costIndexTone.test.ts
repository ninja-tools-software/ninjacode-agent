import { describe, expect, it } from "vitest";
import {
  costIndexColor,
  costIndexTone,
  formatCostIndex,
} from "./costIndexTone.js";

describe("costIndexTone", () => {
  it("maps low values near green and high values near red", () => {
    expect(costIndexTone(0)).toBe(0);
    expect(costIndexTone(0.3)).toBeLessThan(0.15);
    expect(costIndexTone(10)).toBeGreaterThan(0.4);
    expect(costIndexTone(10)).toBeLessThan(0.7);
    expect(costIndexTone(50)).toBeGreaterThan(0.85);
    expect(costIndexTone(80)).toBe(1);
    expect(costIndexTone(200)).toBe(1);
  });

  it("returns a greenish hsl for cheap models and reddish for tip models", () => {
    const cheap = costIndexColor(0.3);
    const tip = costIndexColor(55);
    expect(cheap).toMatch(/^hsl\(/);
    const cheapHue = Number(cheap.match(/hsl\(([\d.]+)/)?.[1]);
    const tipHue = Number(tip.match(/hsl\(([\d.]+)/)?.[1]);
    expect(cheapHue).toBeGreaterThan(100);
    expect(tipHue).toBeLessThan(30);
  });

  it("formats the numeric value without a currency symbol", () => {
    expect(formatCostIndex(14.4)).toBe("14.4");
    expect(formatCostIndex(0.3)).toBe("0.3");
    expect(formatCostIndex(10)).toBe("10");
    expect(formatCostIndex(1.25)).toBe("1.25");
  });
});
