import { isChatCompletionModel } from "./chatModels.js";
import {
  fetchAnthropicModels,
  fetchMammouthDiscoveryModels,
  fetchOpenAiCompatibleModels,
  fetchOpenRouterModels,
} from "./fetch.js";
import type { DiscoverProviderInput, DiscoveredModel } from "./types.js";

async function fetchByKind(
  input: DiscoverProviderInput,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const { kind, baseUrl, discoveryUrl, apiKey } = input;
  if (discoveryUrl?.trim()) {
    return fetchOpenAiCompatibleModels(discoveryUrl.trim(), apiKey, signal);
  }
  if (kind === "anthropic") return fetchAnthropicModels(apiKey, baseUrl, signal);
  if (kind === "openrouter") return fetchOpenRouterModels(apiKey, signal);
  if (kind === "mammouth") return fetchMammouthDiscoveryModels(apiKey, signal);
  return fetchOpenAiCompatibleModels(baseUrl, apiKey, signal);
}

/** Unified provider model discovery — all upstream kinds, chat models only. */
export async function discoverProviderModels(
  input: DiscoverProviderInput,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const models = await fetchByKind(input, signal);
  return models.filter((m) => isChatCompletionModel(m.upstreamModel));
}
