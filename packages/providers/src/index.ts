export type {
  Role,
  ToolCall,
  Message,
  ContentPart,
  ToolSpec,
  TokenUsage,
  CompletionRequest,
  Completion,
  StreamEvent,
  StreamSink,
  LlmProvider,
  ReasoningEffort,
  ProviderKind,
} from "./types.js";
export {
  LlmError,
  emptyUsage,
  wantsTools,
  hasImageParts,
  isReasoningEffort,
  REASONING_EFFORTS,
} from "./types.js";

export {
  listProviderCatalogs,
  getProviderCatalog,
  getModelInfo,
  findModelAnywhere,
} from "./catalog.js";

export { contextPresetsFor } from "./models.js";
export type {
  ArenaScore,
  BenchmarkDomain,
  ModelBenchmark,
  ModelInfo,
  ModelLlmStats,
  ModelPricing,
  ProviderCatalog,
  ReasoningSupport,
} from "./models.js";

export { catalogCostIndex, sortModelsByCostIndex } from "./catalogCostIndex.js";

export { resolveModelPricing } from "./pricing.js";

export {
  listGatewayModels,
  listGatewayModelInfos,
  listRoutableGatewayModels,
  getGatewayModel,
  buildGatewayPriceTables,
  buildGatewayCreditTable,
  GOOGLE_BASE,
  MISTRAL_BASE,
  ANTHROPIC_BASE,
  DEEPSEEK_BASE,
  OPENROUTER_BASE,
} from "./gatewayModels.js";
export type {
  GatewayModelEntry,
  GatewayPriceTable,
  GatewayRouteTemplate,
  GatewayUpstreamKind,
  ModelCapabilities,
} from "./gatewayModels.js";

export type {
  GatewayEnvKeys,
  ResolvedGatewayRoute,
} from "./gatewayRegistry.js";
export {
  resolveGatewayRoutes,
  gatewayEnvFromProcess,
} from "./gatewayRegistry.js";
export {
  selectRoutes,
  toResolvedRoutes,
  gatewayEnvHasKey,
} from "./selectRoutes.js";
export type { RouteCandidate, RouteFilter } from "./selectRoutes.js";
export {
  OpenAICompatibleProvider,
  createOpenAIProvider,
  createDeepSeekProvider,
  createOpenRouterProvider,
  createMoonshotProvider,
  createGlmProvider,
  createMistralProvider,
  createXaiProvider,
  createMammouthProvider,
} from "./openai-compatible.js";
export type { OpenAICompatibleConfig } from "./openai-compatible.js";

export { fetchMammouthModels, MAMMOUTH_MODELS_URL } from "./modelDiscovery.js";

export {
  fetchAnthropicModels,
  fetchMammouthDiscoveryModels,
  fetchOpenAiCompatibleModels,
  fetchOpenRouterModels,
  discoverProviderModels,
  reconcileDiscoveredRoutes,
  resolveDiscoveredModelTarget,
  isDeprecationPast,
  shouldDeprecateModel,
  summarizeProposals,
} from "./discovery/index.js";
export type {
  DiscoveredModel,
  DiscoverProviderInput,
  ReconcileProposal,
  ProposalCounts,
} from "./discovery/index.js";

export { AnthropicProvider } from "./anthropic.js";
export type { AnthropicConfig } from "./anthropic.js";

export { applyAnthropicCacheBreakpoints } from "./anthropicCache.js";
export { promptCacheKey } from "./promptCache.js";
export type { AnthropicCacheablePayload } from "./anthropicCache.js";

export { MockProvider, EchoProvider } from "./mock.js";
export type { MockScript } from "./mock.js";

export { NinjaCodeGatewayProvider } from "./gateway.js";
export type { GatewayConfig } from "./gateway.js";

export {
  GatewayError,
  parseGatewayError,
  isTerminalGatewayCode,
  gatewayErrorInfo,
} from "./gatewayErrors.js";
export type { GatewayErrorCode, GatewayErrorInfo } from "./gatewayErrors.js";

export type { ProviderFactoryOptions } from "./providerFactory.js";
export { buildProvider as createProvider } from "./providerFactory.js";
