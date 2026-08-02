/**
 * What the session has *spent* so far: tokens billed across every turn.
 *
 * Deliberately separate from the ContextMeter in the footer, which answers a
 * different question — how full the context window is right now.
 */
import { ArrowDownIcon, ArrowUpIcon, BoltIcon, ChevronDownIcon, ChevronUpIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { formatTokens } from "../format.js";
import type { SessionUsage } from "../types.js";

/**
 * Share of input that came from the prompt cache. Worth watching: this repo's
 * harness treats a stable cache prefix as an invariant, and a collapsing rate
 * is the first symptom of having broken it.
 */
function cacheHitRate(usage: SessionUsage): number | null {
  const total = usage.inputTokens + usage.cacheReadTokens;
  if (total <= 0) return null;
  return Math.round((usage.cacheReadTokens / total) * 100);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-stats-row">
      <span className="session-stats-row-label">{label}</span>
      <span className="session-stats-row-value">{value}</span>
    </div>
  );
}

function SessionStatsSummary({
  usage,
  expanded,
  onToggle,
}: {
  usage: SessionUsage;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="session-stats-summary"
      aria-expanded={expanded}
      aria-label={t("Session token usage")}
      onClick={() => onToggle(!expanded)}
    >
      <span className="session-stats-metric" data-tooltip={t("Input tokens sent this session")}>
        <ArrowUpIcon size={11} />
        {formatTokens(usage.inputTokens)}
      </span>
      <span className="session-stats-metric" data-tooltip={t("Output tokens generated")}>
        <ArrowDownIcon size={11} />
        {formatTokens(usage.outputTokens)}
      </span>
      {usage.cacheReadTokens > 0 && (
        <span className="session-stats-metric cached" data-tooltip={t("Input tokens served from cache")}>
          <BoltIcon size={11} />
          {formatTokens(usage.cacheReadTokens)}
        </span>
      )}
      <span className="session-stats-spacer" />
      <span className="session-stats-turns">
        {usage.turns} {usage.turns === 1 ? t("turn") : t("turns")}
      </span>
      <span className="session-stats-chevron">
        {expanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
      </span>
    </button>
  );
}

function SessionStatsDetailPanel({ usage, rate }: { usage: SessionUsage; rate: number | null }) {
  return (
    <div className="session-stats-detail">
      <DetailRow label={t("Input")} value={`${formatTokens(usage.inputTokens)} tok`} />
      <DetailRow label={t("Output")} value={`${formatTokens(usage.outputTokens)} tok`} />
      <DetailRow label={t("Cache read")} value={`${formatTokens(usage.cacheReadTokens)} tok`} />
      <DetailRow label={t("Cache write")} value={`${formatTokens(usage.cacheWriteTokens)} tok`} />
      {rate !== null && <DetailRow label={t("Cache hit rate")} value={`${rate}%`} />}
      {usage.model && (
        <DetailRow
          label={usage.resolvedModel ? t("Requested model") : t("Model")}
          value={usage.model}
        />
      )}
      {usage.resolvedModel && <DetailRow label={t("Resolved model")} value={usage.resolvedModel} />}
    </div>
  );
}

export function SessionStatsBar({
  usage,
  expanded,
  onToggle,
}: {
  usage: SessionUsage;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  const rate = cacheHitRate(usage);

  return (
    <div className="session-stats">
      <SessionStatsSummary usage={usage} expanded={expanded} onToggle={onToggle} />
      {expanded && <SessionStatsDetailPanel usage={usage} rate={rate} />}
    </div>
  );
}
