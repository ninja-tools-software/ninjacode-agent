import { useState } from "react";
import { ChartIcon, ChevronLeftIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import type { ModelInfo } from "../types.js";
import { hasArenaScores, hasBenchmarkData, hasIndices } from "./modelBenchmark.js";
import { BenchmarkArenaView, BenchmarkIndicesView } from "./modelBenchmarkViews.js";

type BenchTab = "indices" | "arena";

function BenchmarkEmptyState() {
  return (
    <div className="model-bench-empty">
      <ChartIcon size={22} />
      <div className="model-bench-empty-title">{t("No benchmark data yet")}</div>
      <p className="model-bench-empty-hint">
        {t("This model has not been synced with Artificial Analysis or Design Arena yet.")}
      </p>
    </div>
  );
}

function BenchmarkTabs({ tab, onChange }: { tab: BenchTab; onChange: (t: BenchTab) => void }) {
  return (
    <div className="segmented model-bench-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === "indices"}
        className={tab === "indices" ? "active" : ""}
        onClick={() => onChange("indices")}
      >
        {t("Indices")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "arena"}
        className={tab === "arena" ? "active" : ""}
        onClick={() => onChange("arena")}
      >
        {t("Design Arena")}
      </button>
    </div>
  );
}

function BenchmarkContent({
  model,
  tab,
  showTabs,
  indices,
  arena,
}: {
  model: ModelInfo;
  tab: BenchTab;
  showTabs: boolean;
  indices: boolean;
  arena: boolean;
}) {
  const showIndices = showTabs ? tab === "indices" : indices;
  const showArena = showTabs ? tab === "arena" : arena;
  return (
    <>
      {showIndices && model.benchmark ? <BenchmarkIndicesView benchmark={model.benchmark} /> : null}
      {showArena && model.arenaScores ? <BenchmarkArenaView scores={model.arenaScores} /> : null}
    </>
  );
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
  const indices = hasIndices(model);
  const arena = hasArenaScores(model);
  const showTabs = indices && arena;
  const [tab, setTab] = useState<BenchTab>(indices ? "indices" : "arena");
  const hasData = hasBenchmarkData(model);

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
          {showTabs ? <BenchmarkTabs tab={tab} onChange={setTab} /> : null}
          <BenchmarkContent
            model={model}
            tab={tab}
            showTabs={showTabs}
            indices={indices}
            arena={arena}
          />
          {attribution ? <p className="model-bench-attribution">{attribution}</p> : null}
        </>
      )}
    </div>
  );
}
