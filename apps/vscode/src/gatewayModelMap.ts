import type {
  ArenaScore,
  BenchmarkDomain,
  ModelBenchmark,
  ModelInfo,
} from "@ninjacode/providers";

/** Retired Auto router aliases — coalesce to the single virtual `auto` model. */
const RETIRED_AUTO_IDS = new Set(["auto-balanced", "auto-frontier"]);

const BENCHMARK_DOMAINS = new Set<BenchmarkDomain>(["intelligence", "coding", "agentic"]);

export interface GatewayModelWire {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutput?: number;
  vision?: boolean;
  hostingRegion?: string | null;
  catalog?: string;
  tags?: string[];
  /** Relative cost signal from the gateway; null for Auto / unpriced. */
  costIndex?: number | null;
  /** Untrusted wire payload — normalized before entering ModelInfo. */
  benchmark?: unknown;
  arenaScores?: unknown;
}

function clampIndex(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
}

function normalizeDomains(raw: unknown): BenchmarkDomain[] {
  if (!Array.isArray(raw)) return [];
  const out: BenchmarkDomain[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (!BENCHMARK_DOMAINS.has(item as BenchmarkDomain)) continue;
    const domain = item as BenchmarkDomain;
    if (!out.includes(domain)) out.push(domain);
  }
  return out;
}

/** Normalize a gateway benchmark payload; null when absent or empty of usable data. */
export function normalizeBenchmark(raw: unknown): ModelBenchmark | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const intelligenceIndex = clampIndex(obj.intelligenceIndex);
  const codingIndex = clampIndex(obj.codingIndex);
  const agenticIndex = clampIndex(obj.agenticIndex);
  const strengths = normalizeDomains(obj.strengths);
  const weaknesses = normalizeDomains(obj.weaknesses);
  const hasIndex =
    intelligenceIndex !== null || codingIndex !== null || agenticIndex !== null;
  if (!hasIndex && strengths.length === 0 && weaknesses.length === 0) return null;
  return { intelligenceIndex, codingIndex, agenticIndex, strengths, weaknesses };
}

/** Normalize Design Arena scores; drops entries without a numeric elo. */
export function normalizeArenaScores(raw: unknown): ArenaScore[] {
  if (!Array.isArray(raw)) return [];
  const out: ArenaScore[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.elo !== "number" || !Number.isFinite(row.elo)) continue;
    out.push({
      arena: typeof row.arena === "string" ? row.arena : "",
      category: typeof row.category === "string" ? row.category : "",
      elo: row.elo,
      winRate:
        typeof row.winRate === "number" && Number.isFinite(row.winRate) ? row.winRate : null,
    });
  }
  return out;
}

type WireExtras = {
  catalogSlug?: string;
  costIndex: number | null;
  benchmark: ModelBenchmark | null;
  arenaScores: ArenaScore[];
};

function wireExtras(m: GatewayModelWire, known: ModelInfo | undefined, catalogSlug?: string): WireExtras {
  return {
    catalogSlug,
    costIndex: m.costIndex !== undefined ? m.costIndex : (known?.costIndex ?? null),
    benchmark: normalizeBenchmark(m.benchmark),
    arenaScores: normalizeArenaScores(m.arenaScores),
  };
}

function remoteOnlyModel(m: GatewayModelWire, extras: WireExtras): ModelInfo {
  return {
    id: m.id,
    label: m.label ?? m.id,
    contextWindow: m.contextWindow ?? 128_000,
    maxOutput: m.maxOutput ?? 8_192,
    vision: m.vision,
    hostingRegion: m.hostingRegion ?? null,
    catalog: m.catalog ?? extras.catalogSlug,
    tags: m.tags ?? [],
    costIndex: extras.costIndex,
    benchmark: extras.benchmark,
    arenaScores: extras.arenaScores,
  };
}

function mergeKnownModel(m: GatewayModelWire, known: ModelInfo, extras: WireExtras): ModelInfo {
  // API fields win for anything the server can vary per catalog; static fills
  // capabilities the wire format does not carry (reasoning, editFormat, …).
  // costIndex is the only cost signal on the wire — full rate tables stay off.
  return {
    ...known,
    label: m.label ?? known.label,
    contextWindow: m.contextWindow ?? known.contextWindow,
    maxOutput: m.maxOutput ?? known.maxOutput,
    vision: m.vision ?? known.vision,
    hostingRegion: m.hostingRegion ?? known.hostingRegion,
    catalog: m.catalog ?? extras.catalogSlug,
    tags: m.tags ?? known.tags,
    costIndex: extras.costIndex,
    benchmark: extras.benchmark,
    arenaScores: extras.arenaScores,
    price: undefined,
  };
}

/** Merge a gateway `/v1/models` entry with the static catalog entry when present. */
export function mapGatewayModel(
  m: GatewayModelWire,
  known: ModelInfo | undefined,
  catalogSlug?: string,
): ModelInfo {
  const extras = wireExtras(m, known, catalogSlug);
  if (!known) return remoteOnlyModel(m, extras);
  return mergeKnownModel(m, known, extras);
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
