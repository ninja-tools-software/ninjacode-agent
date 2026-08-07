import type { BenchmarkDomain, ModelBenchmark, ModelLlmStats } from "@ninjacode/providers";
import type { ModelInfo } from "../types.js";

type ScoreTone = "accent" | "warn" | "danger";

type IndexRow = {
  key: BenchmarkDomain;
  label: string;
  value: number | null;
};

type LlmStatsRow = {
  key: "score" | "reasoning" | "coding" | "agent";
  label: string;
  value: number | null;
};

/** LLM Stats TrueSkill conservative ratings scale (admin / gateway contract). */
export const LLM_STATS_MAX = 60;

/** True when the model has AA indices, LLM Stats, or Design Arena scores. */
export function hasBenchmarkData(model: ModelInfo): boolean {
  return (
    model.benchmark != null ||
    model.llmStats != null ||
    (model.arenaScores?.length ?? 0) > 0
  );
}

export function hasIndices(model: ModelInfo): boolean {
  return model.benchmark != null;
}

export function hasLlmStats(model: ModelInfo): boolean {
  return model.llmStats != null;
}

export function hasArenaScores(model: ModelInfo): boolean {
  return (model.arenaScores?.length ?? 0) > 0;
}

/** Three index rows for the Indices tab (labels are i18n keys). */
export function indexRows(benchmark: ModelBenchmark): IndexRow[] {
  return [
    { key: "intelligence", label: "Intelligence", value: benchmark.intelligenceIndex },
    { key: "coding", label: "Coding", value: benchmark.codingIndex },
    { key: "agentic", label: "Agentic", value: benchmark.agenticIndex },
  ];
}

/** Four metric rows for the LLM Stats tab (labels are i18n keys). */
export function llmStatsRows(stats: ModelLlmStats): LlmStatsRow[] {
  return [
    { key: "score", label: "Overall", value: stats.score },
    { key: "reasoning", label: "Reasoning", value: stats.reasoningIndex },
    { key: "coding", label: "Coding", value: stats.codingIndex },
    { key: "agent", label: "Agent", value: stats.agentIndex },
  ];
}

/**
 * Color band for a score on a given scale (default 0–100).
 * Thresholds are proportional: low < 40%, mid < 70%, else high.
 */
export function scoreTone(value: number, max = 100): ScoreTone {
  const scale = max > 0 ? max : 100;
  const pct = (value / scale) * 100;
  if (pct < 40) return "danger";
  if (pct < 70) return "warn";
  return "accent";
}

/** Bar fill width as a percent of `max` (clamped 0–100). */
export function gaugeBarWidth(value: number, max = 100): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/** English label (i18n key) for a benchmark domain chip. */
export function domainLabel(key: BenchmarkDomain): string {
  switch (key) {
    case "intelligence":
      return "Intelligence";
    case "coding":
      return "Coding";
    case "agentic":
      return "Agentic";
  }
}

/** English label for a Design Arena category; falls back to the raw value. */
export function arenaCategoryLabel(category: string): string {
  switch (category) {
    case "codecategories":
      return "Code";
    case "uicomponent":
      return "UI Component";
    case "gamedev":
      return "Game Dev";
    case "dataviz":
      return "Data Viz";
    default:
      return category;
  }
}

/** Bar width as a percent of the model's best ELO. */
export function arenaBarWidth(elo: number, maxElo: number): number {
  if (maxElo <= 0) return 0;
  return Math.max(0, Math.min(100, (elo / maxElo) * 100));
}

/**
 * Percent string for a win-rate (0–1 fraction or already 0–100).
 * Returns null when the arena did not report a rate.
 */
export function formatWinRate(winRate: number | null): string | null {
  if (winRate === null || !Number.isFinite(winRate)) return null;
  const pct = winRate <= 1 ? winRate * 100 : winRate;
  return String(Math.round(pct));
}

/** Mean of non-null intelligence / coding / agentic indices; null if none. */
export function performanceScore(
  benchmark: ModelBenchmark | null | undefined,
): number | null {
  if (!benchmark) return null;
  const values = [
    benchmark.intelligenceIndex,
    benchmark.codingIndex,
    benchmark.agenticIndex,
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** High score → green, low → yellow → orange → red (mirror of costIndex). */
export function performanceScoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 100));
  const hue = 120 * t;
  return `hsl(${hue.toFixed(1)} 65% 42%)`;
}

/** Rounded label for the performance pill. */
export function formatPerformanceScore(score: number): string {
  return String(Math.round(score));
}

/** Region code → English label used as i18n key / tooltip. */
export function regionLabel(region: string): string {
  switch (region.toUpperCase()) {
    case "US":
      return "United States";
    case "CN":
      return "China";
    case "EU":
      return "European Union";
    default:
      return region;
  }
}
