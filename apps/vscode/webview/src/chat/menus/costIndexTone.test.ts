import { describe, expect, it } from "vitest";
import { costIndexColor, formatCostIndex } from "./costIndexTone.js";
import { METRIC_GREEN, METRIC_RED, METRIC_YELLOW, lerpRgb } from "./metricGradient.js";

const green = `rgb(${METRIC_GREEN[0]}, ${METRIC_GREEN[1]}, ${METRIC_GREEN[2]})`;
const yellow = `rgb(${METRIC_YELLOW[0]}, ${METRIC_YELLOW[1]}, ${METRIC_YELLOW[2]})`;
const red = `rgb(${METRIC_RED[0]}, ${METRIC_RED[1]}, ${METRIC_RED[2]})`;

describe("costIndexColor", () => {
  it("is green at or below 10 and red at or above 40", () => {
    expect(costIndexColor(0)).toBe(green);
    expect(costIndexColor(10)).toBe(green);
    expect(costIndexColor(40)).toBe(red);
    expect(costIndexColor(80)).toBe(red);
  });

  it("is yellow at the midpoint and interpolates between stops", () => {
    expect(costIndexColor(25)).toBe(yellow);
    expect(costIndexColor(17.5)).toBe(lerpRgb(METRIC_GREEN, METRIC_YELLOW, 0.5));
    expect(costIndexColor(32.5)).toBe(lerpRgb(METRIC_YELLOW, METRIC_RED, 0.5));
  });
});

describe("formatCostIndex", () => {
  it("formats the numeric value without a currency symbol", () => {
    expect(formatCostIndex(14.4)).toBe("14.4");
    expect(formatCostIndex(0.3)).toBe("0.3");
    expect(formatCostIndex(10)).toBe("10");
    expect(formatCostIndex(1.25)).toBe("1.3");
    expect(formatCostIndex(4.95)).toBe("5");
  });
});
