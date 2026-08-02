import { normalizeUpstreamPrice } from "./pricing.js";
import type { DiscoveredModel } from "./types.js";

interface OpenAiModelListResponse {
  data?: Array<{ id: string; deprecation_date?: string | null; expiration_date?: string | null }>;
}

function readDeprecationDate(
  m: { deprecation_date?: string | null; expiration_date?: string | null },
): string | null | undefined {
  return m.deprecation_date ?? m.expiration_date ?? undefined;
}

/** Fetch model ids from an OpenAI-compatible GET /models endpoint. */
export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Discovery failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as OpenAiModelListResponse;
  return (data.data ?? []).map((m) => ({
    upstreamModel: m.id,
    label: m.id,
    deprecationDate: readDeprecationDate(m),
  }));
}

interface OpenRouterModelResponse {
  data?: Array<{
    id: string;
    name?: string;
    context_length?: number;
    expiration_date?: string | null;
    pricing?: { prompt?: string; completion?: string };
  }>;
}

/** OpenRouter exposes pricing and context on its models endpoint. */
export async function fetchOpenRouterModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`OpenRouter discovery failed (${res.status})`);
  }
  const data = (await res.json()) as OpenRouterModelResponse;
  return (data.data ?? []).map((m) => ({
    upstreamModel: m.id,
    label: m.name ?? m.id,
    contextWindow: m.context_length,
    inputPrice: normalizeUpstreamPrice(m.pricing?.prompt),
    outputPrice: normalizeUpstreamPrice(m.pricing?.completion),
    deprecationDate: m.expiration_date ?? null,
  }));
}

interface AnthropicModelResponse {
  data?: Array<{ id: string; display_name?: string }>;
}

export async function fetchAnthropicModels(
  apiKey: string,
  baseUrl = "https://api.anthropic.com",
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Anthropic discovery failed (${res.status})`);
  }
  const data = (await res.json()) as AnthropicModelResponse;
  return (data.data ?? []).map((m) => ({
    upstreamModel: m.id,
    label: m.display_name ?? m.id,
  }));
}

export const MAMMOUTH_DISCOVERY_URL = "https://api.mammouth.ai/public/models";

interface MammouthModelInfo {
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
}

interface MammouthModel {
  id: string;
  model_info?: MammouthModelInfo | null;
  deprecation_date?: string | null;
}

interface MammouthModelsResponse {
  data?: MammouthModel[];
}

/** Mammouth AI — non-standard /public/models endpoint. */
export async function fetchMammouthDiscoveryModels(
  _apiKey: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const res = await fetch(MAMMOUTH_DISCOVERY_URL, { signal });
  if (!res.ok) {
    throw new Error(`Mammouth discovery failed (${res.status})`);
  }
  const data = (await res.json()) as MammouthModelsResponse;
  return (data.data ?? [])
    .filter((m) => Boolean(m.id))
    .map((m) => ({
      upstreamModel: m.id,
      label: m.id,
      contextWindow: m.model_info?.max_input_tokens ?? 128_000,
      maxOutput: m.model_info?.max_output_tokens ?? 8_192,
      deprecationDate: m.deprecation_date ?? null,
    }));
}

