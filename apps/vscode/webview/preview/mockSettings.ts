/**
 * A plausible `settings` payload. The composer toolbar, the model picker and the
 * onboarding gate all read it, so the preview cannot render the chat without one.
 */
import type { SettingsPayload, WireModelInfo } from "../../src/protocol.js";

const MODELS: WireModelInfo[] = [
  {
    id: "auto",
    label: "Auto",
    contextWindow: 200_000,
    maxOutput: 64_000,
    vision: true,
    catalog: "gateway",
    tags: ["routing"],
    costIndex: null,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    contextWindow: 200_000,
    maxOutput: 64_000,
    vision: true,
    reasoning: { kind: "budget", min: 1024, max: 32_000, default: 10_000 },
    defaultContextWindow: 200_000,
    hostingRegion: "eu-west",
    catalog: "gateway",
    tags: ["frontier", "agentic"],
    costIndex: 18,
    benchmark: {
      intelligenceIndex: 62,
      codingIndex: 71,
      agenticIndex: 68,
      strengths: ["coding", "agentic"],
      weaknesses: [],
    },
    llmStats: { score: 48.2, reasoningIndex: 46.1, codingIndex: 51.3, agentIndex: 49.7 },
    arenaScores: [{ arena: "Design Arena", category: "webdev", elo: 1284, winRate: 0.61 }],
  },
  {
    id: "gpt-5-6-sol",
    label: "GPT-5.6 Sol",
    contextWindow: 400_000,
    maxOutput: 128_000,
    vision: true,
    reasoning: { kind: "levels", levels: ["low", "medium", "high", "xhigh"], default: "medium" },
    defaultContextWindow: 272_000,
    hostingRegion: "us-east",
    catalog: "gateway",
    tags: ["frontier", "reasoning"],
    costIndex: 24,
    benchmark: {
      intelligenceIndex: 66,
      codingIndex: 69,
      agenticIndex: 64,
      strengths: ["intelligence"],
      weaknesses: ["agentic"],
    },
    llmStats: { score: 50.4, reasoningIndex: 52.8, codingIndex: 49.9, agentIndex: 47.2 },
    arenaScores: [],
  },
  {
    id: "kimi-k2-7-code",
    label: "Kimi K2.7 Code",
    contextWindow: 256_000,
    maxOutput: 32_000,
    catalog: "gateway",
    tags: ["value"],
    costIndex: 3,
    benchmark: null,
    llmStats: null,
  },
];

const PROVIDER_LABELS: Record<string, string> = {
  gateway: "NinjaCode Pass",
  anthropic: "Anthropic",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  moonshot: "Moonshot",
  glm: "Z.ai GLM",
  mistral: "Mistral",
  xai: "xAI",
  mammouth: "Mammouth",
  "openai-compatible": "OpenAI-compatible",
  local: "Local",
  mock: "Mock",
};

const HAS_API_KEY: Record<string, boolean> = {
  gateway: true,
  anthropic: true,
  openai: false,
  deepseek: false,
  openrouter: false,
  moonshot: false,
  glm: false,
  mistral: false,
  xai: false,
  mammouth: false,
  "openai-compatible": false,
  local: false,
  mock: false,
};

export function mockSettings(overrides: Partial<SettingsPayload> = {}): SettingsPayload {
  return {
    provider: "gateway",
    providers: ["gateway", "anthropic"],
    model: "claude-sonnet-4-6",
    baseUrl: "https://api.ninjacode.dev",
    baseUrls: {
      "openai-compatible": "",
      gateway: "https://api.ninjacode.dev",
      local: "http://127.0.0.1:11434/v1",
    },
    chatLocation: "primary",
    chatSide: "right",
    primarySidebarSide: "right",
    mode: "agent",
    approvalMode: "balanced",
    reasoningEffort: "medium",
    thinkingBudgetTokens: 10_000,
    contextWindow: 0,
    catalogs: [{ kind: "gateway", label: "NinjaCode Pass", models: MODELS }],
    providerLabels: PROVIDER_LABELS,
    models: MODELS,
    modelInfo: MODELS[1],
    favoriteModels: ["claude-sonnet-4-6"],
    modelSort: "cost-asc",
    contextPresets: [64_000, 128_000, 200_000],
    hasApiKey: HAS_API_KEY,
    account: {
      email: "dev@ninjacode.dev",
      credits: 8_420,
      creditsIncluded: 12_000,
      renewsAt: "2026-09-01T00:00:00.000Z",
      passTier: "pro",
      passStreakMonths: 4,
      planKind: "monthly",
      commitmentEndsAt: null,
      cancelAt: null,
      overage: null,
    },
    usage: [],
    plans: null,
    gatewayConfigured: true,
    benchmarkAttribution: "Benchmarks: Artificial Analysis, Design Arena, LLM Stats.",
    locale: "en",
    localeSetting: "auto",
    ...overrides,
  };
}

/** No gateway session and no BYOK key: the welcome screen takes over the chat. */
export function unconfiguredSettings(overrides: Partial<SettingsPayload> = {}): SettingsPayload {
  return mockSettings({
    gatewayConfigured: false,
    account: null,
    hasApiKey: Object.fromEntries(Object.keys(HAS_API_KEY).map((kind) => [kind, false])),
    ...overrides,
  });
}
