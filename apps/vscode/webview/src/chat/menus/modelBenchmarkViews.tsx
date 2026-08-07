import type { ArenaScore, ModelBenchmark, ModelLlmStats } from "@ninjacode/providers";
import { t } from "../../i18n.js";
import {
  arenaBarWidth,
  arenaCategoryLabel,
  domainLabel,
  formatWinRate,
  gaugeBarWidth,
  indexRows,
  LLM_STATS_MAX,
  llmStatsRows,
  scoreTone,
} from "./modelBenchmark.js";

function IndexGauge({
  label,
  value,
  max = 100,
}: {
  label: string;
  value: number | null;
  max?: number;
}) {
  if (value === null) {
    return (
      <div className="model-bench-gauge">
        <div className="model-bench-gauge-top">
          <span className="model-bench-gauge-label">{t(label)}</span>
          <span className="model-bench-gauge-value missing" data-tooltip={t("Not measured")}>
            —
          </span>
        </div>
        <div className="model-bench-gauge-bar missing" aria-hidden="true" />
      </div>
    );
  }
  const tone = scoreTone(value, max);
  const width = gaugeBarWidth(value, max);
  return (
    <div className="model-bench-gauge">
      <div className="model-bench-gauge-top">
        <span className="model-bench-gauge-label">{t(label)}</span>
        <span className={`model-bench-gauge-value tone-${tone}`}>{Math.round(value)}</span>
      </div>
      <div className="model-bench-gauge-bar">
        <div className={`model-bench-gauge-fill tone-${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function DomainChips({
  title,
  domains,
  tone,
}: {
  title: string;
  domains: Array<"intelligence" | "coding" | "agentic">;
  tone: "success" | "warn";
}) {
  if (domains.length === 0) return null;
  return (
    <div className="model-bench-chips-block">
      <div className="model-bench-chips-title">{t(title)}</div>
      <div className="model-bench-chips">
        {domains.map((d) => (
          <span key={d} className={`model-bench-chip tone-${tone}`}>
            {t(domainLabel(d))}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BenchmarkIndicesView({ benchmark }: { benchmark: ModelBenchmark }) {
  return (
    <div className="model-bench-body">
      <div className="model-bench-gauges">
        {indexRows(benchmark).map((row) => (
          <IndexGauge key={row.key} label={row.label} value={row.value} />
        ))}
      </div>
      <DomainChips title="Strengths" domains={benchmark.strengths} tone="success" />
      <DomainChips title="Weaknesses" domains={benchmark.weaknesses} tone="warn" />
    </div>
  );
}

export function BenchmarkLlmStatsView({ stats }: { stats: ModelLlmStats }) {
  return (
    <div className="model-bench-body">
      <div className="model-bench-scale">{t("Scale 0–60")}</div>
      <div className="model-bench-gauges">
        {llmStatsRows(stats).map((row) => (
          <IndexGauge key={row.key} label={row.label} value={row.value} max={LLM_STATS_MAX} />
        ))}
      </div>
    </div>
  );
}

function ArenaRow({
  score,
  maxElo,
}: {
  score: ArenaScore;
  maxElo: number;
}) {
  const win = formatWinRate(score.winRate);
  const width = arenaBarWidth(score.elo, maxElo);
  return (
    <div className="model-bench-arena-row">
      <div className="model-bench-arena-top">
        <span className="model-bench-arena-label">{t(arenaCategoryLabel(score.category))}</span>
        <span className="model-bench-arena-elo">
          {Math.round(score.elo)}
          <span className="model-bench-arena-elo-unit">{t("ELO")}</span>
        </span>
      </div>
      <div className="model-bench-arena-bar">
        <div className="model-bench-arena-fill" style={{ width: `${width}%` }} />
      </div>
      {win !== null && (
        <span className="model-bench-arena-win">{t("{0}% win rate", win)}</span>
      )}
    </div>
  );
}

export function BenchmarkArenaView({ scores }: { scores: ArenaScore[] }) {
  const maxElo = Math.max(...scores.map((s) => s.elo), 0);
  const arenaName = scores.find((s) => s.arena)?.arena;
  return (
    <div className="model-bench-body">
      {arenaName ? <div className="model-bench-arena-subtitle">{arenaName}</div> : null}
      <div className="model-bench-arena-rows">
        {scores.map((score, i) => (
          <ArenaRow key={`${score.category}-${i}`} score={score} maxElo={maxElo} />
        ))}
      </div>
    </div>
  );
}
