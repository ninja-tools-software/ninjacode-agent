import {
  ANTHROPIC_BASE,
  DEEPSEEK_BASE,
  GLM_BASE,
  MISTRAL_BASE,
  MOONSHOT_BASE,
  OPENROUTER_BASE,
  getGatewayModel,
  openRouterClaude,
  openRouterFallback,
} from "./gatewayModels.js";
import type { GatewayModelEntry, GatewayRouteTemplate } from "./gatewayModels.js";
import type { GatewayEnvKeys } from "./gatewayTypes.js";

type ProviderSlug = "moonshot" | "glm" | "mistral";

function providerKindForModel(modelId: string): ProviderSlug | null {
  const id = modelId.toLowerCase();
  if (id.startsWith("kimi") || id.startsWith("moonshot")) return "moonshot";
  if (id.startsWith("glm") || id.startsWith("zhipu")) return "glm";
  if (id.startsWith("mistral") || id.startsWith("codestral") || id.startsWith("pixtral")) {
    return "mistral";
  }
  return null;
}

function nativeRoute(
  provider: ProviderSlug,
  modelId: string,
  env?: GatewayEnvKeys,
): GatewayRouteTemplate {
  const configs: Record<
    ProviderSlug,
    { base: string; apiKeyEnv: GatewayRouteTemplate["apiKeyEnv"] }
  > = {
    moonshot: {
      base: env?.GATEWAY_MOONSHOT_BASE ?? MOONSHOT_BASE,
      apiKeyEnv: "MOONSHOT_API_KEY",
    },
    glm: {
      base: env?.GATEWAY_GLM_BASE ?? GLM_BASE,
      apiKeyEnv: "GLM_API_KEY",
    },
    mistral: {
      base: env?.GATEWAY_MISTRAL_BASE ?? MISTRAL_BASE,
      apiKeyEnv: "MISTRAL_API_KEY",
    },
  };
  const cfg = configs[provider];
  return {
    provider,
    upstreamKind: "openai-compatible",
    baseUrl: cfg.base.replace(/\/$/, ""),
    upstreamModel: modelId,
    apiKeyEnv: cfg.apiKeyEnv,
    secondaryApiKeyEnv: "OPENROUTER_API_KEY",
  };
}

function providerRoute(
  provider: ProviderSlug,
  modelId: string,
  env?: GatewayEnvKeys,
): GatewayRouteTemplate {
  const apiKeyEnv = nativeRoute(provider, modelId, env).apiKeyEnv;
  if (env?.[apiKeyEnv]) return nativeRoute(provider, modelId, env);
  return openRouterFallback(provider, modelId);
}

function deepseekNative(modelId: string): GatewayRouteTemplate {
  return {
    provider: "deepseek",
    upstreamKind: "openai-compatible",
    baseUrl: DEEPSEEK_BASE,
    upstreamModel: modelId,
    apiKeyEnv: "DEEPSEEK_API_KEY",
    secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
  };
}

function openRouterDeepSeek(modelId: string): GatewayRouteTemplate {
  const upstream = modelId.startsWith("deepseek/") ? modelId : `deepseek/${modelId}`;
  return {
    provider: "openrouter",
    upstreamKind: "openai-compatible",
    baseUrl: OPENROUTER_BASE,
    upstreamModel: upstream,
    apiKeyEnv: "OPENROUTER_API_KEY",
    secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
  };
}

function deepseekRoute(modelId: string, env?: GatewayEnvKeys): GatewayRouteTemplate {
  if (env?.DEEPSEEK_API_KEY || env?.GATEWAY_UPSTREAM_KEY) return deepseekNative(modelId);
  return openRouterDeepSeek(modelId);
}

function anthropicNative(modelId: string, env?: GatewayEnvKeys): GatewayRouteTemplate {
  return {
    provider: "anthropic",
    upstreamKind: "anthropic-messages",
    baseUrl: (env?.GATEWAY_ANTHROPIC_BASE ?? ANTHROPIC_BASE).replace(/\/$/, ""),
    upstreamModel: modelId.startsWith("claude") ? modelId : "claude-sonnet-4-20250514",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    secondaryApiKeyEnv: "GATEWAY_UPSTREAM_KEY",
  };
}

function claudeRoute(modelId: string, env?: GatewayEnvKeys): GatewayRouteTemplate {
  if (env?.ANTHROPIC_API_KEY) return anthropicNative(modelId, env);
  return openRouterClaude(modelId);
}

export function resolveApiKey(template: GatewayRouteTemplate, env: GatewayEnvKeys): string {
  const primary = env[template.apiKeyEnv]?.trim();
  if (primary) return primary;
  if (template.secondaryApiKeyEnv) {
    const secondary = env[template.secondaryApiKeyEnv]?.trim();
    if (secondary) return secondary;
  }
  return env.GATEWAY_UPSTREAM_KEY?.trim() ?? "";
}

export function resolveTemplateBaseUrl(
  template: GatewayRouteTemplate,
  env: GatewayEnvKeys,
): string {
  if (template.upstreamKind === "anthropic-messages" && template.provider === "anthropic") {
    return (env.GATEWAY_ANTHROPIC_BASE ?? template.baseUrl).replace(/\/$/, "");
  }
  if (template.provider === "moonshot") {
    return (env.GATEWAY_MOONSHOT_BASE ?? template.baseUrl).replace(/\/$/, "");
  }
  if (template.provider === "glm") {
    return (env.GATEWAY_GLM_BASE ?? template.baseUrl).replace(/\/$/, "");
  }
  if (template.provider === "mistral") {
    return (env.GATEWAY_MISTRAL_BASE ?? template.baseUrl).replace(/\/$/, "");
  }
  return template.baseUrl;
}

export function applyEnvRoutes(
  modelId: string,
  known: GatewayModelEntry,
  env: GatewayEnvKeys,
): GatewayModelEntry {
  if (known.virtual || !known.route) return known;
  if (modelId.startsWith("claude")) {
    return {
      ...known,
      route: claudeRoute(modelId, env),
      failoverRoute: known.failoverRoute ?? openRouterClaude(modelId),
    };
  }
  if (modelId.startsWith("deepseek")) {
    const defaults = getGatewayModel(modelId) ?? getGatewayModel("deepseek-v4-flash")!;
    return {
      ...defaults,
      id: modelId,
      label: known.label ?? modelId,
      route: deepseekRoute(modelId, env),
      failoverRoute: known.failoverRoute ?? openRouterDeepSeek(modelId),
    };
  }
  const provider = providerKindForModel(modelId);
  if (provider && (known.route.provider === provider || known.failoverRoute)) {
    return {
      ...known,
      route: providerRoute(provider, known.route.upstreamModel, env),
      failoverRoute: known.failoverRoute ?? openRouterFallback(provider, modelId),
    };
  }
  return known;
}
