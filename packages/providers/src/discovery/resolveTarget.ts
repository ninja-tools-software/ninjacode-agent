import type { ResolveTargetInput, ResolveTargetResult } from "./types.js";

function sanitizeSlug(upstreamModel: string): string {
  return upstreamModel.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 128);
}

/** Decide whether to attach a discovered route to an existing model or create a new one. */
export function resolveDiscoveredModelTarget(input: ResolveTargetInput): ResolveTargetResult {
  const { upstreamModel, existingModels, existingRoutes, gatewayUpstreamModels } = input;

  for (const route of existingRoutes) {
    if (route.upstreamModel !== upstreamModel) continue;
    const model = existingModels.find((m) => m.id === route.modelId);
    if (model) {
      return { action: "attach", modelId: model.id, slug: model.slug };
    }
  }

  for (const gw of gatewayUpstreamModels) {
    if (gw.upstreamModel !== upstreamModel) continue;
    const model = existingModels.find((m) => m.slug === gw.modelSlug);
    if (model) {
      return { action: "attach", modelId: model.id, slug: model.slug };
    }
  }

  const slug = sanitizeSlug(upstreamModel);
  const bySlug = existingModels.find((m) => m.slug === slug);
  if (bySlug) {
    return { action: "attach", modelId: bySlug.id, slug: bySlug.slug };
  }

  return { action: "create", slug };
}
