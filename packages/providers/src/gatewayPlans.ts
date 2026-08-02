import type { ModelPricing } from "./models.js";

/** Fixed customer-facing value of one credit, in USD (plan price / included credits). */
export const CREDIT_VALUE_USD = 0.01;

/** Target gross margin baked into credit rates derived from provider cost. */
export const CREDIT_TARGET_MARGIN = 0.3;

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

export type GatewayPlanTier = "starter" | "pro" | "ultra";

export interface GatewayPlan {
  tier: GatewayPlanTier;
  label: string;
  /** Monthly subscription price in USD. */
  priceUsd: number;
  /** Credits granted each billing cycle (expire at cycle end, no rollover). */
  monthlyCredits: number;
  /** Usage multiplier vs the base plan (marketing: "3x", "12x"). */
  multiplier: number;
  highlight?: boolean;
}

/**
 * Subscription plans — the only way to buy usage. Degressive: higher plans get
 * more credits per dollar (12x the usage for 7.5x the price).
 */
export const GATEWAY_PLANS: GatewayPlan[] = [
  { tier: "starter", label: "Starter", priceUsd: 20, monthlyCredits: 2_000, multiplier: 1 },
  {
    tier: "pro",
    label: "Pro",
    priceUsd: 50,
    monthlyCredits: 6_000,
    multiplier: 3,
    highlight: true,
  },
  { tier: "ultra", label: "Ultra", priceUsd: 150, monthlyCredits: 24_000, multiplier: 12 },
];

export function getGatewayPlan(tier: string): GatewayPlan | undefined {
  return GATEWAY_PLANS.find((p) => p.tier === tier);
}
