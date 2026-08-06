/** Log reference so tip models (~$50+) saturate red while sub-$1 stay green. */
export const COST_INDEX_REF = 80;

/** 0..1 logarithmic tone; higher = more expensive. */
export function costIndexTone(costIndex: number, ref = COST_INDEX_REF): number {
  if (costIndex <= 0) return 0;
  if (ref <= 0) return 1;
  return Math.min(1, Math.log1p(costIndex) / Math.log1p(ref));
}

/** Green → red HSL color for a cost index value. */
export function costIndexColor(costIndex: number, ref = COST_INDEX_REF): string {
  const t = costIndexTone(costIndex, ref);
  const hue = 120 * (1 - t);
  return `hsl(${hue.toFixed(1)} 65% 42%)`;
}

/** Numeric label only — no currency symbol. At most one decimal place. */
export function formatCostIndex(costIndex: number): string {
  const fixed = costIndex.toFixed(1);
  return fixed.replace(/\.0$/, "");
}
