import { estimateTokens } from "./contextEstimate.js";
import type { Message } from "@ninjacode/providers";

const HISTORY_SOFT_LIMIT = 40;
const HISTORY_HARD_LIMIT = 80;
const KEEP_RECENT = 30;

interface CompactionLimits {
  softLimit: number;
  hardLimit: number;
  keepRecent: number;
  tokenSoftThreshold: number;
  tokenHardThreshold: number;
}

export function computeCompactionLimits(contextWindow?: number): CompactionLimits {
  const softLimit =
    contextWindow && contextWindow > 0
      ? Math.max(8, Math.floor((contextWindow * 0.6) / 750))
      : HISTORY_SOFT_LIMIT;
  const hardLimit = Math.max(softLimit + 10, HISTORY_HARD_LIMIT);
  const keepRecent = Math.min(KEEP_RECENT, Math.max(8, Math.floor(softLimit * 0.75)));
  const tokenSoftThreshold =
    contextWindow && contextWindow > 0 ? Math.floor(contextWindow * 0.72) : 0;
  const tokenHardThreshold =
    contextWindow && contextWindow > 0 ? Math.floor(contextWindow * 0.85) : 0;
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

  const totalTokens =
    estimateTokens(msgs) + (opts.systemTokens ?? 0) + (opts.toolTokens ?? 0);
  const overTokenSoft = limits.tokenSoftThreshold > 0 && totalTokens > limits.tokenSoftThreshold;
  const overTokenHard = limits.tokenHardThreshold > 0 && totalTokens > limits.tokenHardThreshold;

  if (!overTokenSoft && !overTokenHard && msgs.length <= limits.softLimit) return true;
  if (!overTokenHard && msgs.length <= limits.hardLimit && !opts.contextWindow) return true;
  return !overTokenSoft && !overTokenHard && msgs.length <= limits.hardLimit && !!opts.contextWindow;
}
