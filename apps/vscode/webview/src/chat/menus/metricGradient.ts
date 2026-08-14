/** Theme semantic colors (match --success / --warn / --danger in tokens.css). */
import { rgbCss, tokenToRgb, type Rgb } from "../../themeTokens.js";

export const METRIC_GREEN = [63, 185, 80] as const;
export const METRIC_YELLOW = [210, 153, 34] as const;
export const METRIC_RED = [248, 81, 73] as const;

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** Linear RGB interpolation → `rgb(r, g, b)`. */
export function lerpRgb(a: Rgb, b: Rgb, t: number): string {
  const u = clamp01(t);
  const r = Math.round(a[0] + (b[0] - a[0]) * u);
  const g = Math.round(a[1] + (b[1] - a[1]) * u);
  const bl = Math.round(a[2] + (b[2] - a[2]) * u);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Status stops from CSS tokens; fallbacks are the historic GitHub-like RGB. */
export function themeMetricStops(): { green: Rgb; yellow: Rgb; red: Rgb } {
  return {
    green: tokenToRgb("--success", METRIC_GREEN),
    yellow: tokenToRgb("--warn", METRIC_YELLOW),
    red: tokenToRgb("--danger", METRIC_RED),
  };
}

/**
 * Three-stop gradient along a numeric axis.
 * Below `lo` → `loColor`, at `mid` → `midColor`, at/above `hi` → `hiColor`.
 */
export function gradientAtStops(
  value: number,
  lo: number,
  mid: number,
  hi: number,
  loColor: Rgb,
  midColor: Rgb,
  hiColor: Rgb,
): string {
  if (value <= lo) return rgbCss(loColor);
  if (value >= hi) return rgbCss(hiColor);
  if (value <= mid) return lerpRgb(loColor, midColor, (value - lo) / (mid - lo));
  return lerpRgb(midColor, hiColor, (value - mid) / (hi - mid));
}
