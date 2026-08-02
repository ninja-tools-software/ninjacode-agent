import type { ModelInfo } from "@ninjacode/providers";

/** Retired Auto router aliases — coalesce to the single virtual `auto` model. */
const RETIRED_AUTO_IDS = new Set(["auto-balanced", "auto-frontier"]);

export interface GatewayModelWire {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
  hostingRegion?: string | null;
  catalog?: string;
  tags?: string[];
}

/** Merge a gateway `/v1/models` entry with the static catalog entry when present. */
export function mapGatewayModel(
  m: GatewayModelWire,
  known: ModelInfo | undefined,
  catalogSlug?: string,
): ModelInfo {
  if (!known) {
    return {
      id: m.id,
      label: m.label ?? m.id,
      contextWindow: m.contextWindow ?? 128_000,
      maxOutput: m.maxOutput ?? 8_192,
      vision: m.vision,
      hostingRegion: m.hostingRegion ?? null,
      catalog: m.catalog ?? catalogSlug,
      tags: m.tags ?? [],
    };
  }
  // API fields win for anything the server can vary per catalog; static fills
  // capabilities the wire format does not carry (reasoning, editFormat, …).
  // Never surface per-model rates (price/credits) in the agent catalog.
  return {
    ...known,
    label: m.label ?? known.label,
    contextWindow: m.contextWindow ?? known.contextWindow,
    maxOutput: m.maxOutput ?? known.maxOutput,
    vision: m.vision ?? known.vision,
    hostingRegion: m.hostingRegion ?? known.hostingRegion,
    catalog: m.catalog ?? catalogSlug,
    tags: m.tags ?? known.tags,
    price: undefined,
  };
}

function coalesceModelId(id: string): string {
  return RETIRED_AUTO_IDS.has(id) ? "auto" : id;
}

/** Normalize a stored model id against the live list (retired Auto aliases, missing ids). */
export function resolveSelectedModel(
  model: string,
  models: ModelInfo[],
): { model: string; modelInfo: ModelInfo | undefined; corrected: boolean } {
  const preferred = coalesceModelId(model);
  const fromList =
    (preferred ? models.find((m) => m.id === preferred) : undefined) ?? models[0];
  const next = fromList?.id ?? preferred;
  return {
    model: next,
    modelInfo: fromList,
    corrected: Boolean(model) && next !== model,
  };
}

/** Drop favorites that are no longer in the live list; remap retired Auto aliases. */
export function normalizeFavoriteModels(favorites: string[], models: ModelInfo[]): string[] {
  const live = new Set(models.map((m) => m.id));
  const out: string[] = [];
  for (const id of favorites) {
    const next = coalesceModelId(id);
    if (live.has(next) && !out.includes(next)) out.push(next);
  }
  return out;
}
