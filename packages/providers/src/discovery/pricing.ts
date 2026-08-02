/** Largest value that fits `numeric(12,6)` (6 digits before the decimal point). */
const MAX_NUMERIC_12_6 = 999_999.999_999;

/**
 * Normalize an upstream per-token price into a per-million-token price
 * safe to persist in `numeric(12,6)`. Providers sometimes report sentinel
 * values (e.g. OpenRouter's `-1` for dynamically priced models) or missing
 * fields — those are rejected rather than silently stored.
 */
export function normalizeUpstreamPrice(perTokenPrice: string | number | null | undefined): number | undefined {
  if (perTokenPrice == null) return undefined;
  const value = typeof perTokenPrice === "number" ? perTokenPrice : Number(perTokenPrice);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const perMillion = Math.round(value * 1_000_000 * 1e6) / 1e6;
  if (perMillion > MAX_NUMERIC_12_6) return undefined;
  return perMillion;
}
