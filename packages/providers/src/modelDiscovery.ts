import type { ModelInfo } from "./models.js";

/** Mammouth AI publishes its model list at a non-standard (not /v1/models) path. */
export const MAMMOUTH_MODELS_URL = "https://api.mammouth.ai/public/models";

interface MammouthModelInfo {
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
}

interface MammouthModel {
  id: string;
  object?: string;
  model_info?: MammouthModelInfo | null;
}

interface MammouthModelsResponse {
  data?: MammouthModel[];
}

/** Non-chat model ids we don't want to surface in the chat model picker. */
function isChatModel(id: string): boolean {
  if (id.startsWith("text-embedding")) return false;
  if (id.includes("image")) return false;
  return true;
}

/**
 * Fetch the list of models exposed by Mammouth AI. The JSON payload follows the
 * OpenAI `{ data: [...] }` shape but lives at `/public/models` instead of the
 * standard `/v1/models`. Returns an empty array on any network/parse failure so
 * callers can fall back to the static catalog.
 */
export async function fetchMammouthModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  try {
    const res = await fetch(MAMMOUTH_MODELS_URL, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as MammouthModelsResponse;
    const list = data.data ?? [];
    return list
      .filter((m) => Boolean(m.id) && isChatModel(m.id))
      .map((m) => ({
        id: m.id,
        label: m.id,
        contextWindow: m.model_info?.max_input_tokens ?? 128_000,
        maxOutput: m.model_info?.max_output_tokens ?? 8_192,
      }));
  } catch {
    return [];
  }
}
