/** Relative cost signal: USD per M input + output tokens, rounded to cents. */
export function catalogCostIndex(cost: { input: number; output: number }): number {
  return Math.round((cost.input + cost.output) * 100) / 100;
}

/** Auto first, then priced models by costIndex descending, nulls last. */
export function sortModelsByCostIndex<T extends { id: string; costIndex?: number | null; tags?: string[] }>(
  models: T[],
): T[] {
  const isAuto = (m: T) => m.id === "auto" || Boolean(m.tags?.includes("auto"));
  const auto = models.filter(isAuto);
  const rest = models
    .filter((m) => !isAuto(m))
    .sort((a, b) => {
      const aNull = a.costIndex == null;
      const bNull = b.costIndex == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      return (b.costIndex as number) - (a.costIndex as number);
    });
  return [...auto, ...rest];
}
