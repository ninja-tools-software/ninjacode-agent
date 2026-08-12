import type { ModelPricing } from "./models.js";

/** Fixed customer-facing value of one credit, in USD (plan price / included credits). */
const CREDIT_VALUE_USD = 0.01;

/** Target gross margin baked into credit rates derived from provider cost. */
const CREDIT_TARGET_MARGIN = 0.3;

/** Credits charged per million tokens, per token class. */
export interface GatewayCreditRate {
  input: number;
  output: number;
  /** Credits per million cache-read (cache hit) input tokens. */
  cacheRead?: number;
  /** Credits per million cache-write (cache creation) input tokens. */
  cacheWrite?: number;
}

/**
 * Derive a credit rate from a provider cost table so that fully-consumed
 * credits keep roughly CREDIT_TARGET_MARGIN of gross margin at face value.
 */
export function creditRateFromCost(cost: ModelPricing): GatewayCreditRate {
  const perMillion = (usd: number): number =>
    Math.ceil(usd / (CREDIT_VALUE_USD * (1 - CREDIT_TARGET_MARGIN)));
  const rate: GatewayCreditRate = {
    input: perMillion(cost.input),
    output: perMillion(cost.output),
  };
  if (cost.cacheRead !== undefined) rate.cacheRead = perMillion(cost.cacheRead);
  if (cost.cacheWrite !== undefined) rate.cacheWrite = perMillion(cost.cacheWrite);
  return rate;
}
