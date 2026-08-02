import type { DiscoveredModel, ExistingRoute, ReconcileProposal } from "./types.js";
import { isDeprecationPast } from "./deprecation.js";

const PRICE_DRIFT_THRESHOLD = 0.05;

function priceDrift(a: number, b: number): boolean {
  if (a === 0 && b === 0) return false;
  const base = Math.max(a, b, 0.000_001);
  return Math.abs(a - b) / base > PRICE_DRIFT_THRESHOLD;
}

export interface ReconcileOptions {
  now?: Date;
}

/** Pure reconcile: compare discovered upstream models with existing routes. */
export function reconcileDiscoveredRoutes(
  discovered: DiscoveredModel[],
  existing: ExistingRoute[],
  options: ReconcileOptions = {},
): ReconcileProposal[] {
  const now = options.now ?? new Date();
  const proposals: ReconcileProposal[] = [];
  const existingByUpstream = new Map(existing.map((r) => [r.upstreamModel, r]));
  const discoveredIds = new Set(discovered.map((d) => d.upstreamModel));

  for (const d of discovered) {
    const row = existingByUpstream.get(d.upstreamModel);
    if (!row) {
      proposals.push({
        kind: "new",
        upstreamModel: d.upstreamModel,
        label: d.label,
        proposedCost: {
          input: d.inputPrice ?? 0,
          output: d.outputPrice ?? 0,
        },
        deprecationDate: d.deprecationDate,
      });
      continue;
    }
    if (d.deprecationDate) {
      const retireNow = isDeprecationPast(d.deprecationDate, now);
      proposals.push({
        kind: "deprecated",
        upstreamModel: d.upstreamModel,
        deprecationDate: d.deprecationDate,
        retireNow,
      });
    }
    const proposedInput = d.inputPrice ?? row.costInputPrice;
    const proposedOutput = d.outputPrice ?? row.costOutputPrice;
    if (
      priceDrift(row.costInputPrice, proposedInput) ||
      priceDrift(row.costOutputPrice, proposedOutput)
    ) {
      proposals.push({
        kind: "price_change",
        upstreamModel: d.upstreamModel,
        currentCost: { input: row.costInputPrice, output: row.costOutputPrice },
        proposedCost: { input: proposedInput, output: proposedOutput },
      });
    }
  }

  for (const row of existing) {
    if (row.status === "retired") continue;
    if (!discoveredIds.has(row.upstreamModel)) {
      proposals.push({ kind: "missing", upstreamModel: row.upstreamModel });
    }
  }

  return proposals;
}