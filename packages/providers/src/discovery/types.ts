export interface DiscoveredModel {
  upstreamModel: string;
  label?: string;
  contextWindow?: number;
  maxOutput?: number;
  inputPrice?: number;
  outputPrice?: number;
  /** ISO 8601 date from provider (e.g. OpenRouter expiration_date). */
  deprecationDate?: string | null;
}

export interface ExistingRoute {
  id?: string;
  modelId?: string;
  upstreamModel: string;
  costInputPrice: number;
  costOutputPrice: number;
  status: string;
}

export interface ReconcileProposal {
  kind: "new" | "price_change" | "missing" | "deprecated";
  upstreamModel: string;
  label?: string;
  currentCost?: { input: number; output: number };
  proposedCost?: { input: number; output: number };
  deprecationDate?: string | null;
  /** When true, route should be retired on apply. */
  retireNow?: boolean;
}

export interface DiscoverProviderInput {
  kind: string;
  baseUrl: string;
  discoveryUrl?: string | null;
  apiKey: string;
}

export interface ResolveTargetInput {
  upstreamModel: string;
  providerSlug: string;
  label?: string;
  existingModels: Array<{ id: string; slug: string }>;
  existingRoutes: Array<{ modelId: string; providerId: string; upstreamModel: string }>;
  gatewayUpstreamModels: Array<{ modelSlug: string; upstreamModel: string }>;
}

export interface ResolveTargetResult {
  action: "attach" | "create";
  modelId?: string;
  slug: string;
}