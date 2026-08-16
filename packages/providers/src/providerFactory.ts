import { AnthropicProvider } from "./anthropic.js";
import {
  createDeepSeekProvider,
  createOpenAIProvider,
  createOpenRouterProvider,
  createMoonshotProvider,
  createGlmProvider,
  createMistralProvider,
  createXaiProvider,
  createMammouthProvider,
  OpenAICompatibleProvider,
} from "./openai-compatible.js";
import { EchoProvider, MockProvider } from "./mock.js";
import { NinjaCodeGatewayProvider } from "./gateway.js";
import type { LlmProvider, ProviderKind } from "./types.js";

export interface ProviderFactoryOptions {
  kind: ProviderKind;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

type ProviderFactory = (opts: ProviderFactoryOptions) => LlmProvider;

const anthropicFactory: ProviderFactory = (opts) =>
  new AnthropicProvider({ apiKey: opts.apiKey ?? "", model: opts.model, baseUrl: opts.baseUrl });

const openAiCompatFactory: ProviderFactory = (opts) =>
  new OpenAICompatibleProvider({
    apiKey: opts.apiKey ?? "",
    model: opts.model,
    baseUrl: opts.baseUrl,
  });

const localFactory: ProviderFactory = (opts) =>
  new OpenAICompatibleProvider({
    apiKey: opts.apiKey || "local",
    model: opts.model,
    baseUrl: opts.baseUrl ?? "http://localhost:11434/v1",
    name: "local",
  });

const gatewayFactory: ProviderFactory = (opts) =>
  new NinjaCodeGatewayProvider({
    apiKey: opts.apiKey ?? "",
    model: opts.model,
    baseUrl: opts.baseUrl,
  });

const PROVIDER_FACTORIES: Record<ProviderKind, ProviderFactory> = {
  anthropic: anthropicFactory,
  openai: (opts) => createOpenAIProvider(opts.apiKey ?? "", opts.model),
  deepseek: (opts) => createDeepSeekProvider(opts.apiKey ?? "", opts.model),
  openrouter: (opts) => createOpenRouterProvider(opts.apiKey ?? "", opts.model),
  moonshot: (opts) => createMoonshotProvider(opts.apiKey ?? "", opts.model),
  glm: (opts) => createGlmProvider(opts.apiKey ?? "", opts.model),
  mistral: (opts) => createMistralProvider(opts.apiKey ?? "", opts.model),
  xai: (opts) => createXaiProvider(opts.apiKey ?? "", opts.model),
  mammouth: (opts) => createMammouthProvider(opts.apiKey ?? "", opts.model),
  "openai-compatible": openAiCompatFactory,
  local: localFactory,
  gateway: gatewayFactory,
  mock: () => new MockProvider(),
  echo: () => new EchoProvider(),
};

export function buildProvider(opts: ProviderFactoryOptions): LlmProvider {
  const factory = PROVIDER_FACTORIES[opts.kind];
  return factory(opts);
}
