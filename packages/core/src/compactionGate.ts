import { estimateTokens } from "./contextEstimate.js";
import type { Message } from "@ninjacode/providers";

const HISTORY_HARD_LIMIT = 80;
const KEEP_RECENT = 30;

interface CompactionLimits {
  hardLimit: number;
  keepRecent: number;
  inputBudget: number;
  targetTokens: number;
  tokenHighThreshold: number;
  tokenHardThreshold: number;
}

/** Why the pipeline summarized (or would summarize) history. */
export type CompactionTrigger =
  | "manual"
  | "token_high"
  | "token_hard"
  | "message_hard";

export interface CompactHistoryResult {
  messages: Message[];
  /** True when the returned history is not the same sequence the caller passed in. */
  changed: boolean;
}

export function computeCompactionLimits(
  contextWindow?: number,
  opts: { reservedOutputTokens?: number; safetyMarginTokens?: number } = {},
): CompactionLimits {
  const safetyMargin =
    opts.safetyMarginTokens ??
    (contextWindow && contextWindow > 0 ? Math.max(512, Math.floor(contextWindow * 0.05)) : 0);
  const inputBudget =
    contextWindow && contextWindow > 0
      ? Math.max(1, contextWindow - (opts.reservedOutputTokens ?? 0) - safetyMargin)
      : 0;
  const keepRecent = KEEP_RECENT;
  return {
    hardLimit: HISTORY_HARD_LIMIT,
    keepRecent,
    inputBudget,
    targetTokens: inputBudget > 0 ? Math.floor(inputBudget * 0.6) : 0,
    tokenHighThreshold: inputBudget > 0 ? Math.floor(inputBudget * 0.85) : 0,
    tokenHardThreshold: inputBudget,
  };
}

/** Returns true when lossless compaction alone is sufficient (no summarization needed). */
export function shouldSkipCompaction(
  msgs: Message[],
  limits: CompactionLimits,
  opts: {
    force?: boolean;
    contextWindow?: number;
    systemTokens?: number;
    toolTokens?: number;
    model?: string;
  },
): boolean {
  if (opts.force) return false;
  const pressure = compactionPressure(msgs, limits, opts);
  if (limits.tokenHighThreshold > 0) return !pressure.overTokenHigh;
  return msgs.length <= limits.hardLimit;
}

export function resolveCompactionTrigger(
  msgs: Message[],
  limits: CompactionLimits,
  opts: {
    force?: boolean;
    contextWindow?: number;
    systemTokens?: number;
    toolTokens?: number;
    model?: string;
  },
): CompactionTrigger {
  if (opts.force) return "manual";
  const pressure = compactionPressure(msgs, limits, opts);
  if (pressure.overTokenHard) return "token_hard";
  if (pressure.overTokenHigh) return "token_high";
  if (msgs.length > limits.hardLimit) return "message_hard";
  return "manual";
}

export function compactResult(
  original: Message[],
  messages: Message[],
  summarized = false,
): CompactHistoryResult {
  return { messages, changed: summarized || messagesRewritten(original, messages) };
}

function compactionPressure(
  msgs: Message[],
  limits: CompactionLimits,
  opts: { systemTokens?: number; toolTokens?: number; model?: string },
): { overTokenHigh: boolean; overTokenHard: boolean } {
  const totalTokens =
    estimateTokens(msgs, opts.model) + (opts.systemTokens ?? 0) + (opts.toolTokens ?? 0);
  return {
    overTokenHigh: limits.tokenHighThreshold > 0 && totalTokens > limits.tokenHighThreshold,
    overTokenHard: limits.tokenHardThreshold > 0 && totalTokens > limits.tokenHardThreshold,
  };
}

function messagesRewritten(before: Message[], after: Message[]): boolean {
  if (before.length !== after.length) return true;
  return before.some((msg, i) => {
    const next = after[i];
    return !next || msg.role !== next.role || msg.content !== next.content || msg.name !== next.name;
  });
}
