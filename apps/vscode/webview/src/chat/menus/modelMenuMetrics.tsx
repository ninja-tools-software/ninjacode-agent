import { ChartIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import type { ModelInfo, ModelSortId } from "../types.js";
import { costIndexColor, formatCostIndex } from "./costIndexTone.js";
import {
  formatPerformanceScore,
  performanceBarWidth,
  performanceScore,
  scoreColor,
} from "./modelBenchmark.js";
import { type ModelSortColumn, sortParts } from "./modelSort.js";

export function ModelCostBadge({ costIndex }: { costIndex: number }) {
  const label = formatCostIndex(costIndex);
  return (
    <span
      className="model-menu-cost"
      style={{ ["--metric-tone" as string]: costIndexColor(costIndex) }}
      aria-label={t("Cost index {0}", label)}
      data-tooltip={t("Cost index {0}", label)}
    >
      <span className="model-menu-cost-dot" aria-hidden="true" />
      <span className="model-menu-cost-value">{label}</span>
    </span>
  );
}

function SortHeaderButton({
  column,
  label,
  ariaLabel,
  sort,
  onSort,
}: {
  column: ModelSortColumn;
  label: string;
  ariaLabel: string;
  sort: ModelSortId;
  onSort: (column: ModelSortColumn) => void;
}) {
  const active = sortParts(sort);
  const isActive = active.column === column;
  const previewDirection = isActive ? active.direction : "desc";
  return (
    <button
      type="button"
      className={`model-menu-metrics-sort model-menu-metrics-${column}${isActive ? " active" : ""}`}
      aria-sort={isActive ? (active.direction === "asc" ? "ascending" : "descending") : "none"}
      aria-label={ariaLabel}
      data-tooltip={ariaLabel}
      onClick={() => onSort(column)}
    >
      <span className="model-menu-metrics-sort-label">{label}</span>
      <span className="model-menu-metrics-sort-chevron" aria-hidden="true">
        {previewDirection === "desc" ? <ChevronDownIcon size={10} /> : <ChevronUpIcon size={10} />}
      </span>
    </button>
  );
}

export function ModelMetricsHeader({
  sort,
  onSort,
}: {
  sort: ModelSortId;
  onSort: (column: ModelSortColumn) => void;
}) {
  return (
    <div className="model-menu-metrics-head">
      <span className="model-menu-metrics-head-spacer" />
      <span className="model-menu-metrics-head-cols">
        <SortHeaderButton
          column="cost"
          label={t("Cost")}
          ariaLabel={t("Sort by cost")}
          sort={sort}
          onSort={onSort}
        />
        <SortHeaderButton
          column="perf"
          label={t("Perf")}
          ariaLabel={t("Sort by performance")}
          sort={sort}
          onSort={onSort}
        />
      </span>
      <span className="model-menu-metrics-head-star" />
    </div>
  );
}

function DetailHintIcons({ size }: { size: number }) {
  return (
    <span className="model-menu-detail-icons" aria-hidden="true">
      <ChartIcon size={size} />
      <SearchIcon size={size} />
    </span>
  );
}

function ModelPerfButton({
  model,
  onOpenBenchmark,
}: {
  model: ModelInfo;
  onOpenBenchmark: () => void;
}) {
  const score = performanceScore(model.benchmark);
  if (score === null) {
    return (
      <button
        type="button"
        className="model-menu-bench"
        aria-label={t("Benchmark details for {0}", model.label)}
        data-tooltip={t("Benchmark details")}
        onClick={onOpenBenchmark}
      >
        <DetailHintIcons size={12} />
      </button>
    );
  }
  const label = formatPerformanceScore(score);
  const width = performanceBarWidth(score);
  return (
    <button
      type="button"
      className="model-menu-perf"
      style={{ ["--metric-tone" as string]: scoreColor(score) }}
      aria-label={t("Performance index {0}", label)}
      data-tooltip={t("Performance index {0}", label)}
      onClick={onOpenBenchmark}
    >
      <span className="model-menu-perf-body">
        <span className="model-menu-perf-value">{label}</span>
        <span className="model-menu-perf-bar" aria-hidden="true">
          <span className="model-menu-perf-fill" style={{ width: `${width}%` }} />
        </span>
      </span>
      <DetailHintIcons size={10} />
    </button>
  );
}

export function ModelRowMetrics({
  model,
  onOpenBenchmark,
}: {
  model: ModelInfo;
  onOpenBenchmark: () => void;
}) {
  const hasCost = typeof model.costIndex === "number";
  return (
    <div className="model-menu-metrics">
      <span className="model-menu-metrics-cost">
        {hasCost ? <ModelCostBadge costIndex={model.costIndex as number} /> : null}
      </span>
      <span className="model-menu-metrics-perf">
        <ModelPerfButton model={model} onOpenBenchmark={onOpenBenchmark} />
      </span>
    </div>
  );
}
