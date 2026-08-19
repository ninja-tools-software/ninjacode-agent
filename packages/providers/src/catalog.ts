import { listGatewayModelInfos } from "./gatewayModels.js";
import type { ModelInfo, ProviderCatalog } from "./models.js";
import type { ProviderKind } from "./types.js";

const CATALOG: ProviderCatalog[] = [
  {
    kind: "anthropic",
    label: "Anthropic",
    models: [
      {
        id: "claude-sonnet-4-20250514",
        label: "Claude Sonnet 4",
        contextWindow: 200_000,
        maxOutput: 64_000,
        reasoning: { kind: "budget", min: 1_024, max: 64_000, default: 10_000 },
        vision: true,
      },
      {
        id: "claude-opus-4-20250514",
        label: "Claude Opus 4",
        contextWindow: 200_000,
        maxOutput: 32_000,
        reasoning: { kind: "budget", min: 1_024, max: 32_000, default: 16_000 },
        vision: true,
      },
      {
        id: "claude-haiku-4-5-20251001",
        label: "Claude Haiku 4.5",
        contextWindow: 200_000,
        maxOutput: 64_000,
        vision: true,
      },
    ],
  },
  {
    kind: "openai",
    label: "OpenAI",
    models: [
      {
        id: "gpt-4o",
        label: "GPT-4o",
        contextWindow: 128_000,
        maxOutput: 16_384,
        vision: true,
      },
      {
        id: "gpt-4.1",
        label: "GPT-4.1",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 32_768,
        vision: true,
      },
      {
        id: "o3",
        label: "o3",
        contextWindow: 200_000,
        maxOutput: 100_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
      {
        id: "o4-mini",
        label: "o4-mini",
        contextWindow: 200_000,
        maxOutput: 100_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
    ],
  },
  {
    kind: "deepseek",
    label: "DeepSeek",
    models: [
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
      // Legacy aliases — deprecated by DeepSeek on 2026/07/24, proxied to
      // deepseek-v4-flash (non-thinking / thinking mode respectively) until then.
      {
        id: "deepseek-chat",
        label: "DeepSeek Chat (legacy alias)",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek Reasoner (legacy alias)",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
    ],
  },
  {
    kind: "openrouter",
    label: "OpenRouter",
    models: [
      {
        id: "anthropic/claude-sonnet-4",
        label: "Claude Sonnet 4",
        contextWindow: 200_000,
        maxOutput: 64_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
      {
        id: "openai/gpt-4o",
        label: "GPT-4o",
        contextWindow: 128_000,
        maxOutput: 16_384,
        vision: true,
      },
      {
        id: "openai/o3",
        label: "o3",
        contextWindow: 200_000,
        maxOutput: 100_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
      {
        id: "deepseek/deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
      {
        id: "deepseek/deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        contextWindow: 1_000_000,
        defaultContextWindow: 200_000,
        maxOutput: 384_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
      {
        id: "moonshotai/kimi-k2",
        label: "Kimi K2",
        contextWindow: 256_000,
        maxOutput: 32_768,
      },
      {
        id: "zhipu/glm-4.5",
        label: "GLM 4.5",
        contextWindow: 128_000,
        maxOutput: 32_768,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
      },
      {
        id: "mistralai/mistral-large",
        label: "Mistral Large",
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
    ],
  },
  {
    kind: "moonshot",
    label: "Moonshot AI",
    models: [
      {
        id: "kimi-k2-0711-preview",
        label: "Kimi K2",
        contextWindow: 256_000,
        maxOutput: 32_768,
      },
      {
        id: "moonshot-v1-32k",
        label: "Moonshot v1 32k",
        contextWindow: 32_000,
        maxOutput: 8_192,
      },
      {
        id: "moonshot-v1-128k",
        label: "Moonshot v1 128k",
        contextWindow: 128_000,
        maxOutput: 8_192,
      },
    ],
  },
  {
    kind: "glm",
    label: "GLM (Zhipu)",
    models: [
      {
        id: "glm-4.5",
        label: "GLM 4.5",
        contextWindow: 128_000,
        maxOutput: 32_768,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
      {
        id: "glm-4.5-flash",
        label: "GLM 4.5 Flash",
        contextWindow: 128_000,
        maxOutput: 32_768,
        vision: true,
      },
      {
        id: "glm-4-plus",
        label: "GLM 4 Plus",
        contextWindow: 128_000,
        maxOutput: 16_384,
        vision: true,
      },
    ],
  },
  {
    kind: "mistral",
    label: "Mistral",
    models: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
        contextWindow: 128_000,
        maxOutput: 32_768,
        vision: true,
      },
      {
        id: "mistral-small-latest",
        label: "Mistral Small",
        contextWindow: 128_000,
        maxOutput: 32_768,
      },
      {
        id: "codestral-latest",
        label: "Codestral",
        contextWindow: 256_000,
        maxOutput: 32_768,
      },
    ],
  },
  {
    kind: "xai",
    label: "xAI",
    models: [
      {
        id: "grok-4.6",
        label: "Grok 4.6",
        contextWindow: 500_000,
        maxOutput: 128_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high", "xhigh"], default: "high" },
        vision: true,
      },
      {
        id: "grok-4.5",
        label: "Grok 4.5",
        contextWindow: 500_000,
        maxOutput: 128_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
      {
        id: "grok-4.3",
        label: "Grok 4.3",
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        reasoning: { kind: "levels", levels: ["low", "medium", "high"], default: "medium" },
        vision: true,
      },
    ],
  },
  {
    kind: "mammouth",
    label: "Mammouth AI",
    models: [
      {
        id: "mammouth-recommended",
        label: "Mammouth (recommandé)",
        contextWindow: 1_048_576,
        maxOutput: 131_072,
      },
    ],
  },
  {
    kind: "openai-compatible",
    label: "OpenAI Compatible",
    models: [
      {
        id: "default",
        label: "Default / custom",
        contextWindow: 128_000,
        maxOutput: 8_192,
      },
    ],
  },
  {
    kind: "local",
    label: "Local LLM",
    models: [
      {
        id: "default",
        label: "Local model",
        contextWindow: 32_000,
        maxOutput: 8_192,
      },
    ],
  },
  {
    kind: "gateway",
    label: "NinjaCode Pass",
    models: listGatewayModelInfos(),
  },
  {
    kind: "mock",
    label: "Mock",
    models: [
      {
        id: "mock",
        label: "Mock",
        contextWindow: 32_000,
        maxOutput: 4_096,
      },
    ],
  },
  {
    kind: "echo",
    label: "Echo",
    models: [
      {
        id: "echo",
        label: "Echo",
        contextWindow: 32_000,
        maxOutput: 4_096,
      },
    ],
  },
];

export function listProviderCatalogs(): ProviderCatalog[] {
  return CATALOG;
}

export function getProviderCatalog(kind: ProviderKind): ProviderCatalog | undefined {
  return CATALOG.find((c) => c.kind === kind);
}

export function getModelInfo(kind: ProviderKind, modelId: string): ModelInfo | undefined {
  const catalog = getProviderCatalog(kind);
  if (!catalog) return undefined;
  // Empty id → provider default (first catalog entry). Unknown id → undefined
  // so callers can fall back to a live remote list instead of a wrong model.
  if (!modelId) return catalog.models[0];
  return catalog.models.find((m) => m.id === modelId);
}

export function findModelAnywhere(modelId: string): ModelInfo | undefined {
  for (const c of CATALOG) {
    const m = c.models.find((x) => x.id === modelId);
    if (m) return m;
  }
  return undefined;
}
