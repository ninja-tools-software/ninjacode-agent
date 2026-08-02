/**
 * Running token totals for a session.
 *
 * Kept free of `vscode` imports so the arithmetic can be tested directly: the
 * caller resolves the active provider/model and hands them in.
 */
import type { SessionUsagePayload } from "../protocol.js";

/** The per-turn shape the agent loop emits alongside `{ turn }`. */
export interface TurnTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface UsageContext {
  provider?: string;
  model?: string;
}

const EMPTY: SessionUsagePayload = {
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Fold one turn's provider usage into the running total. */
export function addTurnUsage(
  previous: SessionUsagePayload | null,
  turn: TurnTokenUsage,
  ctx: UsageContext = {},
): SessionUsagePayload {
  const base = previous ?? EMPTY;
  return {
    turns: base.turns + 1,
    inputTokens: base.inputTokens + turn.inputTokens,
    outputTokens: base.outputTokens + turn.outputTokens,
    cacheReadTokens: base.cacheReadTokens + (turn.cacheReadTokens ?? 0),
    cacheWriteTokens: base.cacheWriteTokens + (turn.cacheWriteTokens ?? 0),
    model: ctx.model ?? base.model,
  };
}

/**
 * Rebuild totals for a session restored from disk, from the `totalUsage` block
 * `packages/core` already persists. Returns `null` when nothing was ever spent,
 * so the bar stays hidden on a fresh conversation.
 */
export function seedSessionUsage(
  totalUsage: TurnTokenUsage | undefined,
  turns: number,
  ctx: UsageContext = {},
): SessionUsagePayload | null {
  if (!totalUsage) return null;
  const totals = {
    inputTokens: totalUsage.inputTokens,
    outputTokens: totalUsage.outputTokens,
    cacheReadTokens: totalUsage.cacheReadTokens ?? 0,
    cacheWriteTokens: totalUsage.cacheWriteTokens ?? 0,
  };
  const spent =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  if (spent === 0) return null;
  return {
    turns,
    ...totals,
    model: ctx.model,
  };
}
