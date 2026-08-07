import type { ModelInfo, ModelSortId } from "../types.js";
import { performanceScore } from "./modelBenchmark.js";

export type ModelSortColumn = "cost" | "perf";
type ModelSortDirection = "asc" | "desc";

export const DEFAULT_MODEL_SORT: ModelSortId = "cost-desc";

const VALID_SORT_IDS: ModelSortId[] = ["cost-asc", "cost-desc", "perf-asc", "perf-desc"];

interface ModelSort {
  column: ModelSortColumn;
  direction: ModelSortDirection;
}

export function parseModelSort(value: string | undefined): ModelSortId {
  return VALID_SORT_IDS.includes(value as ModelSortId) ? (value as ModelSortId) : DEFAULT_MODEL_SORT;
}

export function formatModelSort(sort: ModelSort): ModelSortId {
  return `${sort.column}-${sort.direction}`;
}

export function sortParts(id: ModelSortId): ModelSort {
  const [column, direction] = id.split("-") as [ModelSortColumn, ModelSortDirection];
  return { column, direction };
}

/**
 * Clicking the active column flips its direction; clicking the other column
 * switches to it, defaulting to descending (highest value first).
 */
export function toggleSort(current: ModelSortId, column: ModelSortColumn): ModelSortId {
  const active = sortParts(current);
  if (active.column !== column) return formatModelSort({ column, direction: "desc" });
  return formatModelSort({ column, direction: active.direction === "desc" ? "asc" : "desc" });
}

function isAuto(m: ModelInfo): boolean {
  return m.id === "auto" || Boolean(m.tags?.includes("auto"));
}

function metricValue(m: ModelInfo, column: ModelSortColumn): number | null {
  if (column === "cost") return typeof m.costIndex === "number" ? m.costIndex : null;
  return performanceScore(m.benchmark);
}

/**
 * Sorts models by the chosen column/direction. Auto stays pinned first;
 * models without the metric always sink to the bottom regardless of direction.
 */
export function sortModels(models: ModelInfo[], sortId: ModelSortId): ModelInfo[] {
  const { column, direction } = sortParts(sortId);
  const auto = models.filter(isAuto);
  const rest = models.filter((m) => !isAuto(m));
  const sign = direction === "desc" ? -1 : 1;
  const sorted = [...rest].sort((a, b) => {
    const aVal = metricValue(a, column);
    const bVal = metricValue(b, column);
    if (aVal === null && bVal === null) return 0;
    if (aVal === null) return 1;
    if (bVal === null) return -1;
    return sign * (aVal - bVal);
  });
  return [...auto, ...sorted];
}
