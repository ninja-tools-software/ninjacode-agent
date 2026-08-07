import type { ProviderKind, ReasoningEffort } from "./types.js";

/**
 * Shared vocabulary describing a model's capabilities. Lives apart from `catalog.ts`
 * so the catalog can source gateway models without the gateway depending back on it.
 */

export type ReasoningSupport =
  | { kind: "levels"; levels: ReasoningEffort[]; default?: ReasoningEffort }
  | { kind: "budget"; min: number; max: number; default: number };

/** Artificial Analysis benchmark domain, used as a key for strengths/weaknesses chips. */
export type BenchmarkDomain = "intelligence" | "coding" | "agentic";

/** Artificial Analysis indices (0-100) for a model, surfaced in the benchmark panel. */
export interface ModelBenchmark {
  intelligenceIndex: number | null;
  codingIndex: number | null;
  agenticIndex: number | null;
  strengths: BenchmarkDomain[];
  weaknesses: BenchmarkDomain[];
}

/** Design Arena ELO / win-rate for a model, broken down per category. */
export interface ArenaScore {
  arena: string;
  category: string;
  elo: number;
  winRate: number | null;
}

/**
 * LLM Stats TrueSkill conservative ratings (μ − 3σ), typically 0–60.
 * Attribution required when displayed — see gateway `benchmarkAttribution`.
 */
export interface ModelLlmStats {
  score: number | null;
  reasoningIndex: number | null;
  codingIndex: number | null;
  agentIndex: number | null;
}

/** Per-million-token list price in USD, for BYOK providers that publish one. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  /** Max input context window in tokens. */
  contextWindow: number;
  /** Max output tokens. */
  maxOutput: number;
  /**
   * Per-million USD list price for BYOK providers that publish one.
   * Not shown in the agent UI — kept for bench / internal tooling.
   */
  price?: ModelPricing;
  /**
   * Relative cost signal (USD/M input+output). null for Auto / unpriced.
   * Surfaced in the model picker; full rate tables stay off the wire.
   */
  costIndex?: number | null;
  reasoning?: ReasoningSupport;
  /**
   * Recommended context cap for the UI "Default" label.
   * Falls back to `contextWindow` when omitted.
   */
  defaultContextWindow?: number;
  /** Whether this model accepts image content parts. Defaults to false when omitted. */
  vision?: boolean;
  /** Preferred file-edit tool format for this model's training. */
  editFormat?: "string_replace" | "patch";
  /** Gateway Pass: hosting region when known (e.g. EU). */
  hostingRegion?: string | null;
  /** Gateway Pass: catalog slug this model was listed from. */
  catalog?: string;
  tags?: string[];
  /** Gateway Pass: Artificial Analysis benchmark indices, null when not synced yet. */
  benchmark?: ModelBenchmark | null;
  /** Gateway Pass: LLM Stats TrueSkill conservative ratings, null when not synced yet. */
  llmStats?: ModelLlmStats | null;
  /** Gateway Pass: Design Arena ELO/win-rate per category. */
  arenaScores?: ArenaScore[];
}

export interface ProviderCatalog {
  kind: ProviderKind;
  label: string;
  models: ModelInfo[];
}

const CONTEXT_PRESETS = [32_000, 64_000, 128_000, 200_000, 1_000_000] as const;

export function contextPresetsFor(model: ModelInfo): number[] {
  return CONTEXT_PRESETS.filter((n) => n <= model.contextWindow);
}
