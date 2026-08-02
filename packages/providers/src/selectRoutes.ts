import type { GatewayEnvKeys, ResolvedGatewayRoute } from "./gatewayTypes.js";

export interface RouteCandidate {
  modelId: string;
  provider: string;
  upstreamKind: ResolvedGatewayRoute["upstreamKind"];
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
  listPrice: ResolvedGatewayRoute["listPrice"];
  costPrice: ResolvedGatewayRoute["costPrice"];
  priority: number;
  weight: number;
  enabled: boolean;
  status: "active" | "proposed" | "retired";
  healthStatus: string;
  hostingRegion?: string | null;
  providerHostingRegion?: string | null;
  providerJurisdiction?: string | null;
}

export interface RouteFilter {
  /** When set, only routes whose effective hosting region is in this list. */
  hostingRegions?: string[];
  jurisdiction?: string;
}

function effectiveRegion(route: RouteCandidate): string | null {
  return route.hostingRegion ?? route.providerHostingRegion ?? null;
}

function regionAllowed(route: RouteCandidate, filter?: RouteFilter): boolean {
  if (!filter?.hostingRegions?.length && !filter?.jurisdiction) return true;
  if (filter.jurisdiction && route.providerJurisdiction !== filter.jurisdiction) return false;
  if (filter.hostingRegions?.length) {
    const region = effectiveRegion(route);
    if (!region || !filter.hostingRegions.includes(region)) return false;
  }
  return true;
}

/** Pure route selection: enabled, keyed, healthy, region-filtered, sorted by priority. */
export function selectRoutes(
  candidates: RouteCandidate[],
  filter?: RouteFilter,
): RouteCandidate[] {
  return candidates
    .filter(
      (r) =>
        r.enabled &&
        r.status === "active" &&
        r.healthStatus !== "unhealthy" &&
        Boolean(r.apiKey?.trim()) &&
        regionAllowed(r, filter),
    )
    .sort((a, b) => a.priority - b.priority || b.weight - a.weight);
}

export function toResolvedRoutes(selected: RouteCandidate[]): ResolvedGatewayRoute[] {
  return selected.map((r) => ({
    modelId: r.modelId,
    provider: r.provider,
    upstreamKind: r.upstreamKind,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    upstreamModel: r.upstreamModel,
    listPrice: r.listPrice,
    costPrice: r.costPrice,
  }));
}

export function gatewayEnvHasKey(env: GatewayEnvKeys, kind: string): boolean {
  const map: Record<string, keyof GatewayEnvKeys | undefined> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    moonshot: "MOONSHOT_API_KEY",
    glm: "GLM_API_KEY",
    mistral: "MISTRAL_API_KEY",
    google: "GOOGLE_API_KEY",
  };
  const key = map[kind];
  if (key && env[key]?.trim()) return true;
  return Boolean(env.GATEWAY_UPSTREAM_KEY?.trim());
}
