import {
  gradientAtStops,
  METRIC_GREEN,
  METRIC_RED,
  METRIC_YELLOW,
} from "./metricGradient.js";

/** Green ≤ 10, yellow at 25, red ≥ 40 (higher cost = warmer). */
export function costIndexColor(costIndex: number): string {
  return gradientAtStops(
    costIndex,
    10,
    25,
    40,
    METRIC_GREEN,
    METRIC_YELLOW,
    METRIC_RED,
  );
}

/** Numeric label only — no currency symbol. At most one decimal place. */
export function formatCostIndex(costIndex: number): string {
  const fixed = costIndex.toFixed(1);
  return fixed.replace(/\.0$/, "");
}
