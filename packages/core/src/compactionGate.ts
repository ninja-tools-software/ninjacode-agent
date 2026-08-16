import { estimateTokens } from "./contextEstimate.js";
import type { Message } from "@ninjacode/providers";

const DEFAULT_HISTORY_HARD_LIMIT = 80;
const DEFAULT_KEEP_RECENT = 30;
const MIN_HISTORY_HARD_LIMIT = 32;
const MAX_HISTORY_HARD_LIMIT = 320;
const MIN_KEEP_RECENT = 12;
const MAX_KEEP_RECENT = 120;
const BASE_CONTEXT_WINDOW = 128_000;

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
  const scale =
    contextWindow && Number.isFinite(contextWindow) && contextWindow > 0
      ? contextWindow / BASE_CONTEXT_WINDOW
      : undefined;
  const keepRecent =
    scale === undefined
      ? DEFAULT_KEEP_RECENT
      : clamp(Math.round(DEFAULT_KEEP_RECENT * scale), MIN_KEEP_RECENT, MAX_KEEP_RECENT);
  const hardLimit =
    scale === undefined
      ? DEFAULT_HISTORY_HARD_LIMIT
      : Math.max(
          keepRecent + 1,
          clamp(
            Math.round(DEFAULT_HISTORY_HARD_LIMIT * scale),
            MIN_HISTORY_HARD_LIMIT,
            MAX_HISTORY_HARD_LIMIT,
          ),
        );
  return {
    hardLimit,
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
  if (limits.tokenHighThreshold > 0) {
    return !pressure.overTokenHigh && msgs.length <= limits.hardLimit;
  }
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
    return !next || !sameMessage(msg, next);
  });
}

function sameMessage(before: Message, after: Message): boolean {
  return (
    before.role === after.role &&
    before.content === after.content &&
    before.name === after.name &&
    before.toolCallId === after.toolCallId &&
    JSON.stringify(before.toolCalls) === JSON.stringify(after.toolCalls) &&
    JSON.stringify(before.parts) === JSON.stringify(after.parts)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
