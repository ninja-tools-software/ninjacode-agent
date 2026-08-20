import type { ModelPricing } from "./models.js";

/** Fixed customer-facing value of one credit, in USD (plan price / included credits). */
const CREDIT_VALUE_USD = 0.01;

/** Markup factor used when deriving gateway credit rates from provider cost. */
const CREDIT_MARKUP = 1 / 0.7;

/** Credits charged per million tokens, per token class. */
export interface GatewayCreditRate {
  input: number;
  output: number;
  /** Credits per million cache-read (cache hit) input tokens. */
  cacheRead?: number;
  /** Credits per million cache-write (cache creation) input tokens. */
  cacheWrite?: number;
}

/** Derive a credit rate from a provider cost table (list price in credits). */
export function creditRateFromCost(cost: ModelPricing): GatewayCreditRate {
  const perMillion = (usd: number): number => Math.ceil((usd * CREDIT_MARKUP) / CREDIT_VALUE_USD);
  const rate: GatewayCreditRate = {
    input: perMillion(cost.input),
    output: perMillion(cost.output),
  };
  if (cost.cacheRead !== undefined) rate.cacheRead = perMillion(cost.cacheRead);
  if (cost.cacheWrite !== undefined) rate.cacheWrite = perMillion(cost.cacheWrite);
  return rate;
}
