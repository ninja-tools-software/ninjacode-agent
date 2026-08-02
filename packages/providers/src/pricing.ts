import { listGatewayModels } from "./gatewayModels.js";
import type { ModelPricing } from "./models.js";

/**
 * Claude Sonnet list price. Used only when a model id matches nothing we publish
 * a price for: over-estimating a cost ceiling stops a run early, under-estimating
 * it lets a runaway run bill for real money.
 */
const FALLBACK_PRICING: ModelPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

/**
 * Per-million-token price for a model id, whether it is addressed by its Pass id
 * (`deepseek-v4-flash`) or its upstream name behind a route. The gateway catalog
 * is the single place prices are maintained, so this reads from it rather than
 * duplicating a table that would silently go stale.
 */
export function resolveModelPricing(modelId: string | undefined): ModelPricing {
  if (!modelId) return FALLBACK_PRICING;
  const entries = listGatewayModels();
  const match =
    entries.find((e) => e.id === modelId && !e.virtual) ??
    entries.find((e) => e.route?.upstreamModel === modelId) ??
    entries.find((e) => e.failoverRoute?.upstreamModel === modelId);
  return match?.listPrice ?? FALLBACK_PRICING;
}
