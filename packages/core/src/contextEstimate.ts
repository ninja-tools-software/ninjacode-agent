import type { Message, ToolSpec } from "@ninjacode/providers";

/** Rough token estimate (chars / 4) for compaction thresholds. */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Breakdown of estimated tokens consumed by the next LLM call. */
export interface ContextUsageBreakdown {
  system: number;
  history: number;
  tools: number;
  /** Subset of `history` attributable to file-read tool results (informational). */
  files: number;
  /** Reserved output budget (not part of `total`, shown for headroom awareness). */
  output: number;
  /** system + history + tools — the actual input token estimate. */
  total: number;
  /** Context window budget being tracked against (0 if unknown). */
  window: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Estimate the token breakdown for an upcoming completion request, without
 * double-counting: `system` and `history` must be disjoint (i.e. `history`
 * should not include the system message) — callers own that split.
 */
export function estimateContextUsage(opts: {
  system: string;
  history: Message[];
  tools?: ToolSpec[];
  window?: number;
  reservedOutput?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): ContextUsageBreakdown {
  const system = estimateTextTokens(opts.system);
  const history = estimateTokens(opts.history);
  const files = estimateTokens(
    opts.history.filter(
      (m) => m.role === "tool" && (m.name === "read_file" || m.name === "list_dir"),
    ),
  );
  const tools = opts.tools?.length ? estimateTextTokens(JSON.stringify(opts.tools)) : 0;

  return {
    system,
    history,
    tools,
    files,
    output: opts.reservedOutput ?? 0,
    total: system + history + tools,
    window: opts.window ?? 0,
    cacheRead: opts.cacheReadTokens,
    cacheWrite: opts.cacheWriteTokens,
  };
}
