import type { BenchmarkDomain, ModelBenchmark } from "@ninjacode/providers";
import type { ModelInfo } from "../types.js";

type ScoreTone = "accent" | "warn" | "danger";

type IndexRow = {
  key: BenchmarkDomain;
  label: string;
  value: number | null;
};

/** True when the model has Artificial Analysis indices or Design Arena scores. */
export function hasBenchmarkData(model: ModelInfo): boolean {
  return model.benchmark != null || (model.arenaScores?.length ?? 0) > 0;
}

export function hasIndices(model: ModelInfo): boolean {
  return model.benchmark != null;
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

/** Color band for a 0–100 index: low → danger, mid → warn, high → accent. */
export function scoreTone(value: number): ScoreTone {
  if (value < 40) return "danger";
  if (value < 70) return "warn";
  return "accent";
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
