/**
 * Pure arithmetic behind the context meter: how full the window is once the
 * composer's pending badges are counted, and how each part contributes.
 * Kept out of the component so the numbers can be tested without a DOM.
 */
import { formatTokens } from "../format.js";
import type { ContextUsage } from "../types.js";

type UsageLevel = "ok" | "warn" | "danger";

export interface BreakdownRow {
  key: "system" | "history" | "tools" | "output" | "attached";
  label: string;
  tokens: number;
  detail?: string;
}

interface Breakdown {
  /** Tokens already in the window plus what the composer will add. */
  projected: number;
  /** Percentage of the window used, clamped to 100. */
  pct: number;
  level: UsageLevel;
  /** Never negative, even when the projection overflows the window. */
  freeTokens: number;
  rows: BreakdownRow[];
}

const WARN_AT = 70;
const DANGER_AT = 90;

export function usageLevel(pct: number): UsageLevel {
  if (pct >= DANGER_AT) return "danger";
  if (pct >= WARN_AT) return "warn";
  return "ok";
}

/** Share of the window a row occupies, as a percentage clamped to [0, 100]. */
export function rowPercent(tokens: number, window: number): number {
  if (window <= 0 || tokens <= 0) return 0;
  return Math.min(100, (tokens / window) * 100);
}

export function computeBreakdown(usage: ContextUsage, attachedTokens = 0): Breakdown {
  const projected = usage.total + attachedTokens;
  const pct = usage.window > 0 ? Math.min(100, (projected / usage.window) * 100) : 0;

  const rows: BreakdownRow[] = [
    { key: "system", label: "System prompt", tokens: usage.system },
    {
      key: "history",
      label: "History",
      tokens: usage.history,
      detail: usage.files ? `incl. ${formatTokens(usage.files)} tok files` : undefined,
    },
    { key: "tools", label: "Tools", tokens: usage.tools },
    { key: "output", label: "Reserved for output", tokens: usage.output },
  ];
  if (attachedTokens > 0) {
    rows.push({
      key: "attached",
      label: "Attached context",
      tokens: attachedTokens,
      detail: "badges in the composer, sent with the next message",
    });
  }

  return {
    projected,
    pct,
    level: usageLevel(pct),
    freeTokens: Math.max(0, usage.window - projected),
    rows,
  };
}
