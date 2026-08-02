import { getGatewayModel } from "./gatewayModels.js";
import type { GatewayModelEntry, GatewayRouteTemplate } from "./gatewayModels.js";
import { applyEnvRoutes } from "./gatewayRouteBuilders.js";
import type { GatewayEnvKeys, ResolvedGatewayRoute } from "./gatewayTypes.js";
import { resolveApiKey, resolveTemplateBaseUrl } from "./gatewayRouteBuilders.js";
import { selectRoutes, toResolvedRoutes, type RouteCandidate } from "./selectRoutes.js";

function resolveTemplate(
  template: GatewayRouteTemplate,
  entry: GatewayModelEntry,
  env: GatewayEnvKeys,
  modelId: string,
  priority: number,
  costPrice?: GatewayModelEntry["costPrice"],
): RouteCandidate {
  return {
    modelId,
    provider: template.provider,
    upstreamKind: template.upstreamKind,
    baseUrl: resolveTemplateBaseUrl(template, env),
    apiKey: resolveApiKey(template, env),
    upstreamModel: template.upstreamModel,
    listPrice: entry.listPrice,
    costPrice: costPrice ?? entry.costPrice,
    priority,
    weight: 100,
    enabled: true,
    status: "active",
    healthStatus: "healthy",
  };
}

function entryForModel(modelId: string, env: GatewayEnvKeys): GatewayModelEntry | null {
  const known = getGatewayModel(modelId);
  if (!known || known.virtual || !known.route) return null;
  return applyEnvRoutes(modelId, known, env);
}

function buildCandidates(
  entry: GatewayModelEntry,
  env: GatewayEnvKeys,
  modelId: string,
): RouteCandidate[] {
  if (!entry.route) return [];
  const candidates: RouteCandidate[] = [
    resolveTemplate(entry.route, entry, env, modelId, 0),
  ];
  if (entry.failoverRoute) {
    candidates.push(
      resolveTemplate(entry.failoverRoute, entry, env, modelId, 10, entry.costPrice),
    );
  }
  return candidates;
}

/** Static bootstrap resolution — returns ordered route chain (empty when model unknown/virtual). */
export function resolveGatewayRoutes(
  modelId: string,
  env: GatewayEnvKeys = {},
): ResolvedGatewayRoute[] {
  const normalized = modelId.trim();
  if (!normalized || normalized === "auto" || normalized.startsWith("auto-")) return [];
  const entry = entryForModel(normalized, env);
  if (!entry) return [];
  const selected = selectRoutes(buildCandidates(entry, env, normalized));
  return toResolvedRoutes(selected);
}

export function gatewayEnvFromProcess(
  env: NodeJS.ProcessEnv = process.env,
): GatewayEnvKeys {
  return {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    MOONSHOT_API_KEY: env.MOONSHOT_API_KEY,
    GLM_API_KEY: env.GLM_API_KEY,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    GOOGLE_API_KEY: env.GOOGLE_API_KEY,
    GATEWAY_UPSTREAM_KEY: env.GATEWAY_UPSTREAM_KEY,
    GATEWAY_ANTHROPIC_BASE: env.GATEWAY_ANTHROPIC_BASE,
    GATEWAY_MOONSHOT_BASE: env.GATEWAY_MOONSHOT_BASE,
    GATEWAY_GLM_BASE: env.GATEWAY_GLM_BASE,
    GATEWAY_MISTRAL_BASE: env.GATEWAY_MISTRAL_BASE,
  };
}
