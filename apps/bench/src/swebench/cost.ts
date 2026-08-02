import type { ModelPricing } from "@ninjacode/providers";
import { summarizePredictTelemetry } from "./telemetry.js";
import type { PredictInstanceRecord, PredictRunMeta } from "./types.js";

/** Ratios to input price used when a price table omits its cache lines. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Cost of one instance from its token buckets. The bench prices runs itself
 * rather than trusting the estimate an agent reports: two runs are only
 * comparable when the same price table was applied to both.
 */
export function estimateCostUsd(record: PredictInstanceRecord, pricing: ModelPricing): number {
  const cacheReadPrice = pricing.cacheRead ?? pricing.input * CACHE_READ_MULTIPLIER;
  const cacheWritePrice = pricing.cacheWrite ?? pricing.input * CACHE_WRITE_MULTIPLIER;
  return (
    ((record.inputTokens ?? 0) / 1e6) * pricing.input +
    ((record.outputTokens ?? 0) / 1e6) * pricing.output +
    ((record.cacheReadTokens ?? 0) / 1e6) * cacheReadPrice +
    ((record.cacheWriteTokens ?? 0) / 1e6) * cacheWritePrice
  );
}

/**
 * Re-price a stored run against a price table. Needed to compare against a run
 * recorded before the price a model actually charges was wired in.
 */
export function repricePredictMeta(meta: PredictRunMeta, pricing: ModelPricing): PredictRunMeta {
  const instances = meta.instances.map((record) =>
    record.inputTokens === undefined
      ? record
      : { ...record, estimatedCostUsd: estimateCostUsd(record, pricing) },
  );
  const costs = instances.filter((r) => r.estimatedCostUsd !== undefined);
  return {
    ...meta,
    instances,
    totalCostUsd: costs.length
      ? costs.reduce((acc, r) => acc + (r.estimatedCostUsd ?? 0), 0)
      : undefined,
    telemetry: summarizePredictTelemetry(instances),
  };
}
