import { ChartIcon, SearchIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import type { ModelInfo } from "../types.js";
import { costIndexColor, formatCostIndex } from "./costIndexTone.js";
import {
  formatPerformanceScore,
  performanceBarWidth,
  performanceScore,
  scoreColor,
} from "./modelBenchmark.js";

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

export function ModelMetricsHeader() {
  return (
    <div className="model-menu-metrics-head" aria-hidden="true">
      <span className="model-menu-metrics-head-spacer" />
      <span className="model-menu-metrics-head-cols">
        <span className="model-menu-metrics-cost">{t("Cost")}</span>
        <span className="model-menu-metrics-perf">{t("Perf")}</span>
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
