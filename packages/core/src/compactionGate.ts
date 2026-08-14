import { estimateTokens } from "./contextEstimate.js";
import type { Message } from "@ninjacode/providers";

const HISTORY_SOFT_LIMIT = 40;
const HISTORY_HARD_LIMIT = 80;
const KEEP_RECENT = 30;

export interface CompactionLimits {
  softLimit: number;
  hardLimit: number;
  keepRecent: number;
  tokenSoftThreshold: number;
  tokenHardThreshold: number;
}

/** Why the pipeline summarized (or would summarize) history. */
export type CompactionTrigger =
  | "manual"
  | "token_soft"
  | "token_hard"
  | "message_soft"
  | "message_hard";

export interface CompactHistoryResult {
  messages: Message[];
  /** True when the returned history is not the same sequence the caller passed in. */
  changed: boolean;
}

export function computeCompactionLimits(contextWindow?: number): CompactionLimits {
  const softLimit =
    contextWindow && contextWindow > 0
      ? Math.max(8, Math.floor((contextWindow * 0.6) / 750))
      : HISTORY_SOFT_LIMIT;
  const hardLimit = Math.max(softLimit + 10, HISTORY_HARD_LIMIT);
  const keepRecent = Math.min(KEEP_RECENT, Math.max(8, Math.floor(softLimit * 0.75)));
  const tokenSoftThreshold =
    contextWindow && contextWindow > 0 ? Math.floor(contextWindow * 0.85) : 0;
  const tokenHardThreshold =
    contextWindow && contextWindow > 0 ? Math.floor(contextWindow * 0.95) : 0;
  return {
    softLimit,
    hardLimit,
    keepRecent,
    tokenSoftThreshold,
    tokenHardThreshold,
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
  },
): boolean {
  if (opts.force) return false;
  const pressure = compactionPressure(msgs, limits, opts);
  if (pressure.overTokenSoft || pressure.overTokenHard) return false;
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
  },
): CompactionTrigger {
  if (opts.force) return "manual";
  const pressure = compactionPressure(msgs, limits, opts);
  if (pressure.overTokenHard) return "token_hard";
  if (pressure.overTokenSoft) return "token_soft";
  if (msgs.length > limits.hardLimit) return "message_hard";
  if (msgs.length > limits.softLimit) return "message_soft";
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
  opts: { systemTokens?: number; toolTokens?: number },
): { overTokenSoft: boolean; overTokenHard: boolean } {
  const totalTokens = estimateTokens(msgs) + (opts.systemTokens ?? 0) + (opts.toolTokens ?? 0);
  return {
    overTokenSoft: limits.tokenSoftThreshold > 0 && totalTokens > limits.tokenSoftThreshold,
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
