import { useState, type ReactNode } from "react";
import { ArrowUpIcon, AttachIcon, BotIcon, HistoryIcon, SettingsIcon } from "../../icons.js";
import { formatTokens } from "../format.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import { useDismiss } from "../hooks/useDismiss.js";
import { t } from "../../i18n.js";
import type { ContextUsage } from "../types.js";
import { computeBreakdown, rowPercent, type BreakdownRow } from "./contextBreakdown.js";

const ROW_ICONS: Record<BreakdownRow["key"], ReactNode> = {
  system: <BotIcon size={12} />,
  history: <HistoryIcon size={12} />,
  tools: <SettingsIcon size={12} />,
  output: <ArrowUpIcon size={12} />,
  attached: <AttachIcon size={12} />,
};

function ContextMeterOverview({
  rows,
  window,
  projected,
  freeTokens,
}: {
  rows: ReturnType<typeof computeBreakdown>["rows"];
  window: number;
  projected: number;
  freeTokens: number;
}) {
  return (
    <>
      <div
        className="context-popover-overview"
        title={`${formatTokens(projected)} / ${formatTokens(window)} tokens`}
      >
        {rows.map((row) => {
          const segPct = rowPercent(row.tokens, window);
          if (segPct <= 0) return null;
          return (
            <div
              key={row.key}
              className={`context-popover-segment seg-${row.key}`}
              style={{ width: `${segPct}%` }}
            />
          );
        })}
      </div>
      <div className="context-popover-total">
        <span className="context-popover-total-used">{t("{0} tok used", formatTokens(projected))}</span>
        <span className="context-popover-total-sep">·</span>
        <span className="context-popover-total-free">
          {t("{0} tok free of {1}", formatTokens(freeTokens), formatTokens(window))}
        </span>
      </div>
    </>
  );
}

function ContextMeterRows({
  rows,
  window,
}: {
  rows: ReturnType<typeof computeBreakdown>["rows"];
  window: number;
}) {
  return (
    <div className="context-popover-rows">
      {rows.map((row) => {
        const rowPct = rowPercent(row.tokens, window);
        return (
          <div className="context-popover-row" key={row.key}>
            <span className={`context-popover-row-icon seg-${row.key}`}>{ROW_ICONS[row.key]}</span>
            <div className="context-popover-row-main">
              <div className="context-popover-row-top">
                <span className="context-popover-row-label">{t(row.label)}</span>
                <span className="context-popover-row-value">{t("{0} tok", formatTokens(row.tokens))}</span>
              </div>
              <div className="context-popover-row-bar">
                <div
                  className={`context-popover-row-fill seg-${row.key}`}
                  style={{ width: `${Math.max(row.tokens > 0 ? 2 : 0, rowPct)}%` }}
                />
              </div>
              {row.detail ? (
                <span className="context-popover-row-detail">
                  {row.key === "history"
                    ? t("incl. {0} tok files", row.detail)
                    : t(row.detail)}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContextMeterPopover({
  pct,
  level,
  projected,
  freeTokens,
  rows,
  usage,
  onCompact,
  onClose,
  closing,
}: {
  pct: number;
  level: ReturnType<typeof computeBreakdown>["level"];
  projected: number;
  freeTokens: number;
  rows: ReturnType<typeof computeBreakdown>["rows"];
  usage: ContextUsage;
  onCompact: () => void;
  onClose: () => void;
  closing?: boolean;
}) {
  return (
    <div
      className={animCls(
        "context-popover anim-pop anim-pop-origin-bottom",
        closing && "anim-closing",
      )}
      role="dialog"
      aria-label={t("Context usage details")}
    >
      <div className="context-popover-header">
        <div className="context-popover-title">
          <span className={`context-popover-dot level-${level}`} />
          <span>{t("Context window")}</span>
        </div>
        <span className={`context-popover-pct level-${level}`}>{Math.round(pct)}%</span>
      </div>

      <ContextMeterOverview rows={rows} window={usage.window} projected={projected} freeTokens={freeTokens} />

      <ContextMeterRows rows={rows} window={usage.window} />

      <div className="context-popover-actions">
        <button
          className="btn context-popover-compact"
          onClick={() => {
            onClose();
            onCompact();
          }}
        >
          {t("Compact now")}
        </button>
        <span className="context-popover-hint">{t("or type /compact")}</span>
      </div>
    </div>
  );
}

function ContextMeterBar({
  open,
  level,
  pct,
  projected,
  window,
  onToggle,
}: {
  open: boolean;
  level: ReturnType<typeof computeBreakdown>["level"];
  pct: number;
  projected: number;
  window: number;
  onToggle: () => void;
}) {
  const rounded = Math.round(pct);
  const title = `${formatTokens(projected)} / ${formatTokens(window)} · ${t("Context usage details")}`;
  return (
    <button
      type="button"
      className="context-meter"
      aria-expanded={open}
      aria-label={title}
      title={title}
      onClick={onToggle}
    >
      <div className="context-meter-bar" aria-hidden="true">
        <div
          className={`context-meter-fill level-${level}`}
          style={{ width: `${pct > 0 ? Math.max(1.5, pct) : 0}%` }}
        />
      </div>
      <span className={`context-meter-pct level-${level}`}>{rounded}%</span>
    </button>
  );
}

export function ContextMeter({
  usage,
  attachedTokens = 0,
  onCompact,
}: {
  usage: ContextUsage;
  /** Tokens the composer's badges will add to the next request. */
  attachedTokens?: number;
  onCompact: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuPresence = useAnimatedPresence(open);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const { projected, pct, level, freeTokens, rows } = computeBreakdown(usage, attachedTokens);

  return (
    <div className="context-meter-wrap panel-enter" ref={rootRef}>
      {menuPresence.mounted && (
        <ContextMeterPopover
          pct={pct}
          level={level}
          projected={projected}
          freeTokens={freeTokens}
          rows={rows}
          usage={usage}
          onCompact={onCompact}
          onClose={() => setOpen(false)}
          closing={menuPresence.closing}
        />
      )}
      <ContextMeterBar
        open={open}
        level={level}
        pct={pct}
        projected={projected}
        window={usage.window}
        onToggle={() => setOpen((v) => !v)}
      />
    </div>
  );
}
