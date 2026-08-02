import { creditRateFromCost } from "./gatewayPlans.js";
import type { GatewayCreditRate } from "./gatewayPlans.js";
import type { ModelInfo, ReasoningSupport } from "./models.js";

/** Upstream transport used by the gateway proxy. */
export type GatewayUpstreamKind = "openai-compatible" | "anthropic-messages";

export interface GatewayPriceTable {
  input: number;
  output: number;
  /** Per-million price for cache-read (cache hit) input tokens, when supported. */
  cacheRead?: number;
  /** Per-million price for cache-write (cache creation) input tokens, when supported. */
  cacheWrite?: number;
}

export interface GatewayRouteTemplate {
  /** Stored on usage records. */
  provider: string;
  upstreamKind: GatewayUpstreamKind;
  baseUrl: string;
  upstreamModel: string;
  /** Primary env var for the upstream API key. */
  apiKeyEnv:
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "DEEPSEEK_API_KEY"
    | "OPENROUTER_API_KEY"
    | "MOONSHOT_API_KEY"
    | "GLM_API_KEY"
    | "MISTRAL_API_KEY"
    | "GOOGLE_API_KEY"
    | "GATEWAY_UPSTREAM_KEY";
  /** Optional secondary env var tried before GATEWAY_UPSTREAM_KEY. */
  secondaryApiKeyEnv?:
    | "OPENAI_API_KEY"
    | "ANTHROPIC_API_KEY"
    | "DEEPSEEK_API_KEY"
    | "OPENROUTER_API_KEY"
    | "MOONSHOT_API_KEY"
    | "GLM_API_KEY"
    | "MISTRAL_API_KEY"
    | "GOOGLE_API_KEY"
    | "GATEWAY_UPSTREAM_KEY";
}

/** Quality axes used by the Auto router (aligned with backend TaskProfile). */
export interface ModelCapabilities {
  reasoningDepth: number;
  codeEditScope: number;
  agenticToolUse: number;
  vision: boolean;
  precisionCritical: boolean;
}

export interface GatewayModelEntry {
  id: string;
  label: string;
  contextWindow: number;
  maxOutput: number;
  listPrice: GatewayPriceTable;
  costPrice: GatewayPriceTable;
  /**
   * When true, the entry is UI-only (Auto router). It is not routable and must
   * not appear in price/credit tables — billing always uses a real model slug.
   */
  virtual?: boolean;
  route?: GatewayRouteTemplate;
  /** Optional failover route when the primary upstream returns 429/5xx. */
  failoverRoute?: GatewayRouteTemplate;
  vision?: boolean;
  reasoning?: ReasoningSupport;
  /** Recommended context cap for the UI Default label; falls back to contextWindow. */
  defaultContextWindow?: number;
  editFormat?: ModelInfo["editFormat"];
  capabilities?: ModelCapabilities;
}

export const DEEPSEEK_BASE = "https://api.deepseek.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const ANTHROPIC_BASE = "https://api.anthropic.com";
export const MOONSHOT_BASE = "https://api.moonshot.ai/v1";
export const GLM_BASE = "https://open.bigmodel.cn/api/paas/v4";
export const MISTRAL_BASE = "https://api.mistral.ai/v1";
/** Google Generative Language OpenAI-compatible endpoint (Gemini). */
export const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

type ProviderSlug = "moonshot" | "glm" | "mistral";

function openRouterModel(provider: ProviderSlug, modelId: string): string {
  const map: Record<ProviderSlug, string> = {
    moonshot: "moonshotai",
    glm: "zhipu",
    mistral: "mistralai",
  };
  const slug = map[provider];
  if (modelId.startsWith(`${slug}/`)) return modelId;
  return `${slug}/${modelId}`;
}

export function openRouterFallback(provider: ProviderSlug, modelId: string): GatewayRouteTemplate {
  return {
    provider: "openrouter",
    upstreamKind: "openai-compatible",
    baseUrl: OPENROUTER_BASE,
    upstreamModel: openRouterModel(provider, modelId),
    apiKeyEnv: "OPENROUTER_API_KEY",
    secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
  };
}

export function openRouterClaude(modelId: string): GatewayRouteTemplate {
  return {
    provider: "openrouter",
    upstreamKind: "openai-compatible",
    baseUrl: OPENROUTER_BASE,
    upstreamModel: modelId.startsWith("claude") ? `anthropic/${modelId}` : "anthropic/claude-sonnet-4",
    apiKeyEnv: "OPENROUTER_API_KEY",
    secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
  };
}

/** Static Pass catalog — single source of truth for gateway model metadata + default routes. */
const GATEWAY_MODELS: GatewayModelEntry[] = [
  {
    id: "auto",
    label: "Auto",
    contextWindow: 200_000,
    maxOutput: 64_000,
    listPrice: { input: 0, output: 0 },
    costPrice: { input: 0, output: 0 },
    virtual: true,
    vision: true,
    reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
  },
  {
    id: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    contextWindow: 200_000,
    maxOutput: 64_000,
    listPrice: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    costPrice: { input: 2.4, output: 12, cacheRead: 0.24, cacheWrite: 3.0 },
    route: {
      provider: "anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: ANTHROPIC_BASE,
      upstreamModel: "claude-sonnet-4-20250514",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      secondaryApiKeyEnv: "OPENROUTER_API_KEY",
    },
    failoverRoute: openRouterClaude("claude-sonnet-4-20250514"),
    vision: true,
    reasoning: { kind: "budget", min: 1_024, max: 64_000, default: 10_000 },
    editFormat: "string_replace",
    capabilities: {
      reasoningDepth: 3,
      codeEditScope: 3,
      agenticToolUse: 3,
      vision: true,
      precisionCritical: true,
    },
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    contextWindow: 128_000,
    maxOutput: 16_384,
    listPrice: { input: 2.5, output: 10 },
    costPrice: { input: 2.0, output: 8 },
    route: {
      provider: "openai",
      upstreamKind: "openai-compatible",
      baseUrl: OPENAI_BASE,
      upstreamModel: "gpt-4o",
      apiKeyEnv: "OPENAI_API_KEY",
      secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
    },
    vision: true,
    editFormat: "patch",
    capabilities: {
      reasoningDepth: 2,
      codeEditScope: 2,
      agenticToolUse: 2,
      vision: true,
      precisionCritical: true,
    },
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    contextWindow: 1_000_000,
    defaultContextWindow: 200_000,
    maxOutput: 384_000,
    listPrice: { input: 0.14, output: 0.28, cacheRead: 0.014 },
    costPrice: { input: 0.1, output: 0.2, cacheRead: 0.01 },
    route: {
      provider: "deepseek",
      upstreamKind: "openai-compatible",
      baseUrl: DEEPSEEK_BASE,
      upstreamModel: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
    },
    reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
    capabilities: {
      reasoningDepth: 1,
      codeEditScope: 1,
      agenticToolUse: 1,
      vision: false,
      precisionCritical: false,
    },
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    contextWindow: 1_000_000,
    defaultContextWindow: 200_000,
    maxOutput: 384_000,
    listPrice: { input: 0.55, output: 1.1, cacheRead: 0.055 },
    costPrice: { input: 0.4, output: 0.8, cacheRead: 0.04 },
    route: {
      provider: "deepseek",
      upstreamKind: "openai-compatible",
      baseUrl: DEEPSEEK_BASE,
      upstreamModel: "deepseek-v4-pro",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
    },
    reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
    failoverRoute: {
      provider: "openrouter",
      upstreamKind: "openai-compatible",
      baseUrl: OPENROUTER_BASE,
      upstreamModel: "deepseek/deepseek-v4-pro",
      apiKeyEnv: "OPENROUTER_API_KEY",
      secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
    },
    capabilities: {
      reasoningDepth: 2,
      codeEditScope: 2,
      agenticToolUse: 2,
      vision: false,
      precisionCritical: false,
    },
  },
  {
    id: "kimi-k2-0711-preview",
    label: "Kimi K2",
    contextWindow: 256_000,
    maxOutput: 32_768,
    listPrice: { input: 0.15, output: 2.5 },
    costPrice: { input: 0.12, output: 2.0 },
    route: {
      provider: "moonshot",
      upstreamKind: "openai-compatible",
      baseUrl: MOONSHOT_BASE,
      upstreamModel: "kimi-k2-0711-preview",
      apiKeyEnv: "MOONSHOT_API_KEY",
      secondaryApiKeyEnv: "OPENROUTER_API_KEY",
    },
    failoverRoute: openRouterFallback("moonshot", "kimi-k2"),
    editFormat: "string_replace",
    capabilities: {
      reasoningDepth: 2,
      codeEditScope: 2,
      agenticToolUse: 2,
      vision: false,
      precisionCritical: false,
    },
  },
  {
    id: "glm-4.5",
    label: "GLM 4.5",
    contextWindow: 128_000,
    maxOutput: 32_768,
    listPrice: { input: 0.5, output: 1.5 },
    costPrice: { input: 0.4, output: 1.2 },
    route: {
      provider: "glm",
      upstreamKind: "openai-compatible",
      baseUrl: GLM_BASE,
      upstreamModel: "glm-4.5",
      apiKeyEnv: "GLM_API_KEY",
      secondaryApiKeyEnv: "OPENROUTER_API_KEY",
    },
    failoverRoute: openRouterFallback("glm", "glm-4.5"),
    reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
    vision: true,
    editFormat: "string_replace",
    capabilities: {
      reasoningDepth: 2,
      codeEditScope: 2,
      agenticToolUse: 2,
      vision: true,
      precisionCritical: false,
    },
  },
  {
    id: "mistral-large-latest",
    label: "Mistral Large",
    contextWindow: 128_000,
    maxOutput: 32_768,
    listPrice: { input: 2, output: 6 },
    costPrice: { input: 1.6, output: 4.8 },
    route: {
      provider: "mistral",
      upstreamKind: "openai-compatible",
      baseUrl: MISTRAL_BASE,
      upstreamModel: "mistral-large-latest",
      apiKeyEnv: "MISTRAL_API_KEY",
      secondaryApiKeyEnv: "OPENROUTER_API_KEY",
    },
    failoverRoute: openRouterFallback("mistral", "mistral-large"),
    vision: true,
    editFormat: "patch",
    capabilities: {
      reasoningDepth: 2,
      codeEditScope: 2,
      agenticToolUse: 2,
      vision: true,
      precisionCritical: true,
    },
  },
];

const GATEWAY_BY_ID = new Map(GATEWAY_MODELS.map((m) => [m.id, m]));

export function getGatewayModel(modelId: string): GatewayModelEntry | undefined {
  return GATEWAY_BY_ID.get(modelId);
}

export function listGatewayModels(): GatewayModelEntry[] {
  return GATEWAY_MODELS;
}

/** Routable models only — excludes virtual aliases like `auto`. */
export function listRoutableGatewayModels(): GatewayModelEntry[] {
  return GATEWAY_MODELS.filter((m) => !m.virtual && m.route);
}

export function listGatewayModelInfos(): ModelInfo[] {
  return GATEWAY_MODELS.map((m) => ({
    id: m.id,
    label: m.label,
    contextWindow: m.contextWindow,
    maxOutput: m.maxOutput,
    // No per-model rates in the agent catalog — pricing lives on the web / admin.
    reasoning: m.reasoning,
    defaultContextWindow: m.defaultContextWindow,
    vision: m.vision,
    editFormat: m.editFormat,
    tags: m.virtual ? ["auto"] : undefined,
  }));
}

export function buildGatewayPriceTables(): {
  list: Record<string, GatewayPriceTable>;
  cost: Record<string, GatewayPriceTable>;
} {
  const list: Record<string, GatewayPriceTable> = {};
  const cost: Record<string, GatewayPriceTable> = {};
  for (const m of GATEWAY_MODELS) {
    if (m.virtual) continue;
    list[m.id] = m.listPrice;
    cost[m.id] = m.costPrice;
  }
  return { list, cost };
}

/** Model → credits conversion table (credits per million tokens), derived from cost prices. */
export function buildGatewayCreditTable(): Record<string, GatewayCreditRate> {
  const credits: Record<string, GatewayCreditRate> = {};
  for (const m of GATEWAY_MODELS) {
    if (m.virtual) continue;
    credits[m.id] = creditRateFromCost(m.costPrice);
  }
  return credits;
}
