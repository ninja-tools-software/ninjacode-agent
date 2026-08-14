import { useState } from "react";
import { ChartIcon, ChevronLeftIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import type { ModelInfo } from "../types.js";
import {
  hasArenaScores,
  hasBenchmarkData,
  hasIndices,
  hasLlmStats,
} from "./modelBenchmark.js";
import {
  BenchmarkArenaView,
  BenchmarkIndicesView,
  BenchmarkLlmStatsView,
} from "./modelBenchmarkViews.js";

type BenchTab = "indices" | "llmStats" | "arena";

const TAB_ORDER: BenchTab[] = ["indices", "llmStats", "arena"];

const TAB_LABEL: Record<BenchTab, string> = {
  indices: "Indices",
  llmStats: "LLM Stats",
  arena: "Design Arena",
};

function availableTabs(model: ModelInfo): BenchTab[] {
  const tabs: BenchTab[] = [];
  if (hasIndices(model)) tabs.push("indices");
  if (hasLlmStats(model)) tabs.push("llmStats");
  if (hasArenaScores(model)) tabs.push("arena");
  return tabs;
}

function BenchmarkEmptyState() {
  return (
    <div className="model-bench-empty">
      <ChartIcon size={16} />
      <div className="model-bench-empty-title">{t("No benchmark data yet")}</div>
      <p className="model-bench-empty-hint">
        {t(
          "This model has not been synced with Artificial Analysis, LLM Stats, or Design Arena yet.",
        )}
      </p>
    </div>
  );
}

function BenchmarkTabs({
  tabs,
  tab,
  onChange,
}: {
  tabs: BenchTab[];
  tab: BenchTab;
  onChange: (t: BenchTab) => void;
}) {
  return (
    <div className="segmented model-bench-tabs" role="tablist">
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          {t(TAB_LABEL[id])}
        </button>
      ))}
    </div>
  );
}

function BenchmarkContent({ model, tab }: { model: ModelInfo; tab: BenchTab }) {
  if (tab === "indices" && model.benchmark) {
    return <BenchmarkIndicesView benchmark={model.benchmark} />;
  }
  if (tab === "llmStats" && model.llmStats) {
    return <BenchmarkLlmStatsView stats={model.llmStats} />;
  }
  if (tab === "arena" && model.arenaScores) {
    return <BenchmarkArenaView scores={model.arenaScores} />;
  }
  return null;
}

export function ModelBenchmarkPanel({
  model,
  attribution,
  onBack,
}: {
  model: ModelInfo;
  attribution?: string | null;
  onBack: () => void;
}) {
  const tabs = availableTabs(model);
  const showTabs = tabs.length >= 2;
  const [tab, setTab] = useState<BenchTab>(() => tabs[0] ?? TAB_ORDER[0]);
  const hasData = hasBenchmarkData(model);
  const activeTab = tabs.includes(tab) ? tab : (tabs[0] ?? TAB_ORDER[0]);

  return (
    <div
      className="model-bench-panel"
      role="region"
      aria-label={t("Benchmark details for {0}", model.label)}
    >
      <div className="model-bench-header">
        <button
          type="button"
          className="model-bench-back"
          aria-label={t("Back to models")}
          data-tooltip={t("Back to models")}
          onClick={onBack}
        >
          <ChevronLeftIcon size={14} />
        </button>
        <span className="model-bench-title">{model.label}</span>
      </div>

      {!hasData ? (
        <BenchmarkEmptyState />
      ) : (
        <>
          {showTabs ? <BenchmarkTabs tabs={tabs} tab={activeTab} onChange={setTab} /> : null}
          <BenchmarkContent model={model} tab={activeTab} />
          {attribution ? <p className="model-bench-attribution">{attribution}</p> : null}
        </>
      )}
    </div>
  );
}
