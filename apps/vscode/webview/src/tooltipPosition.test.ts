import { describe, expect, it } from "vitest";
import { clampTooltipCenterX } from "./tooltipPosition.js";

describe("clampTooltipCenterX", () => {
  it("keeps the center when the tip fits", () => {
    expect(clampTooltipCenterX(100, 80, 400, 6)).toBe(100);
  });

  it("shifts right when the tip would overflow the left edge", () => {
    // half=50, min=56 → center must be at least 56
    expect(clampTooltipCenterX(20, 100, 400, 6)).toBe(56);
  });

  it("shifts left when the tip would overflow the right edge", () => {
    // half=50, max=400-6-50=344
    expect(clampTooltipCenterX(390, 100, 400, 6)).toBe(344);
  });

  it("centers when the tip is wider than the viewport", () => {
    expect(clampTooltipCenterX(10, 500, 200, 6)).toBe(100);
  });
});
