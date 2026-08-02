import type { ProviderKind, ReasoningEffort } from "./types.js";

/**
 * Shared vocabulary describing a model's capabilities. Lives apart from `catalog.ts`
 * so the catalog can source gateway models without the gateway depending back on it.
 */

export type ReasoningSupport =
  | { kind: "levels"; levels: ReasoningEffort[]; default?: ReasoningEffort }
  | { kind: "budget"; min: number; max: number; default: number };

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
