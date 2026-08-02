import type { GatewayPriceTable, GatewayUpstreamKind } from "./gatewayModels.js";

export interface GatewayEnvKeys {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  MOONSHOT_API_KEY?: string;
  GLM_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GATEWAY_UPSTREAM_KEY?: string;
  GATEWAY_ANTHROPIC_BASE?: string;
  GATEWAY_MOONSHOT_BASE?: string;
  GATEWAY_GLM_BASE?: string;
  GATEWAY_MISTRAL_BASE?: string;
}

export interface ResolvedGatewayRoute {
  modelId: string;
  provider: string;
  upstreamKind: GatewayUpstreamKind;
  baseUrl: string;
  apiKey: string;
  upstreamModel: string;
  listPrice: GatewayPriceTable;
  costPrice: GatewayPriceTable;
}
