import type { LlmProvider, Message, ToolSpec } from "@ninjacode/providers";
import { computeCompactionLimits, shouldSkipCompaction } from "./compactionGate.js";
import { estimateTextTokens, estimateTokens } from "./contextEstimate.js";
import { maskOldObservations } from "./observationMasking.js";
import { alignCompactionStart, normalizeToolHistory } from "./toolHistory.js";
import { softenSupersededReads } from "./toolAnnotations.js";
import { stubSupersededVolatileContext } from "./volatileContext.js";

export { softenSupersededReads } from "./toolAnnotations.js";

const TOOL_OUTPUT_MAX = 8_000;
/** Matches packages/tools READ_FILE_MAX_CHARS so harness never re-truncates a clean read. */
const READ_FILE_OUTPUT_MAX = 40_000;
const HISTORY_HARD_LIMIT = 80;
const KEEP_RECENT = 30;

/** Per-tool soft cap for tool results in history / compaction. */
export function toolOutputLimit(toolName?: string): number {
  if (toolName === "read_file") return READ_FILE_OUTPUT_MAX;
  return TOOL_OUTPUT_MAX;
}

/** Marks a message as the product of compaction, which must never be recompressed. */
const COMPACTION_MARKER = "[Compacted earlier conversation]";

/** Sectioned summaries need more room than a free-form paragraph. */
const SUMMARY_MAX_TOKENS = 2_048;

/**
 * A summary of a summary degrades fast: each pass drops detail the next pass
 * cannot recover. Compaction output is therefore pinned, never re-summarized.
 */
export function isCompactionMessage(message: Message): boolean {
  return message.role === "user" && message.content.startsWith(COMPACTION_MARKER);
}

/**
 * Prefer cutting on a newline so we never split a numbered line mid-glyph.
 * Falls back to the raw index when the window has no newline (e.g. minified output).
 */
function snapToLineBoundary(text: string, index: number, direction: "before" | "after"): number {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  if (direction === "before") {
    const at = text.lastIndexOf("\n", index);
    return at === -1 ? index : at;
  }
  const at = text.indexOf("\n", index);
  return at === -1 ? index : at + 1;
}

/**
 * Progressive compaction — cheap lossless first, LLM summarization last resort.
 * Cuts on line boundaries when possible so the model can still page with offset.
 */
export function truncateToolOutput(output: string, max = TOOL_OUTPUT_MAX): string {
  if (output.length <= max) return output;
  const headBudget = Math.floor(max * 0.7);
  const tailBudget = Math.max(0, max - headBudget - 80);
  const headEnd = snapToLineBoundary(output, headBudget, "before");
  const tailStart = snapToLineBoundary(output, output.length - tailBudget, "after");
  // Guard against head/tail overlap on short-but-over-max inputs.
  const safeTailStart = Math.max(tailStart, headEnd);
  const head = output.slice(0, headEnd);
  const tail = output.slice(safeTailStart);
  const omitted = output.length - head.length - tail.length;
  return `${head}\n\n…[truncated ${Math.max(omitted, output.length - max)} chars]…\n\n${tail}`;
}

/**
 * Runs on every turn, so it only contains rewrites that are stable once applied:
 * truncating oversized outputs, dropping reads a later read superseded, stubbing
 * workspace snapshots a newer one replaced. Nothing here discards information the
 * agent still needs, and nothing here fires on a history that is merely long —
 * rewriting an old message invalidates the cached prefix from that point, which
 * is only worth paying under real context pressure.
 */
export function compactHistoryLossless(history: Message[]): Message[] {
  const msgs = normalizeToolHistory(history).map((m) => {
    if (m.role !== "tool") return m;
    const limit = toolOutputLimit(m.name);
    if (m.content.length > limit) {
      return { ...m, content: truncateToolOutput(m.content, limit) };
    }
    return m;
  });
  return stubSupersededVolatileContext(softenSupersededReads(msgs));
}

/** Telemetry payload emitted whenever compaction actually summarizes history. */
export interface CompactionInfo {
  /** What triggered the compaction. */
  trigger: "soft_limit" | "hard_limit" | "manual";
  /** Messages folded into the summary. */
  messagesSummarized: number;
  /** Messages kept verbatim (recent tail + system). */
  messagesKept: number;
  /** Estimated tokens in the summarized messages before compaction. */
  tokensBefore: number;
  /** Estimated tokens of the resulting summary message. */
  tokensAfter: number;
}

/**
 * Full compaction pipeline. When over hard limit, optionally summarize older turns via LLM.
 */
export async function compactHistory(options: {
  history: Message[];
  pinnedTask?: string;
  provider?: LlmProvider;
  model?: string;
  contextWindow?: number;
  systemTokens?: number;
  toolTokens?: number;
  signal?: AbortSignal;
  force?: boolean;
  onCompaction?: (info: CompactionInfo) => void | Promise<void>;
}): Promise<Message[]> {
  const msgs = compactHistoryLossless(options.history);
  const limits = computeCompactionLimits(options.contextWindow);
  const gate = {
    force: options.force,
    contextWindow: options.contextWindow,
    systemTokens: options.systemTokens,
    toolTokens: options.toolTokens,
  };

  if (shouldSkipCompaction(msgs, limits, gate)) return msgs;

  // Under pressure, spend the free tier first: masking old re-runnable outputs
  // often buys back enough room that no summary — and no LLM call — is needed.
  // A forced compaction is a request for a summary, so it skips the shortcut.
  const masked = maskOldObservations(msgs);
  if (!options.force && shouldSkipCompaction(masked, limits, gate)) return masked;

  const split = splitHistoryForCompaction(masked, options.pinnedTask, limits.keepRecent);
  if (!split) return msgs;

  const summary = await buildCompactionSummary({
    provider: options.provider,
    model: options.model,
    older: split.older,
    pinnedTask: options.pinnedTask,
    signal: options.signal,
  });

  return finalizeCompaction(options, split, summary);
}

function splitHistoryForCompaction(
  msgs: Message[],
  pinnedTask: string | undefined,
  keepRecent: number,
): {
  system: Message[];
  pinnedList: Message[];
  recent: Message[];
  older: Message[];
} | null {
  const system = msgs.filter((m) => m.role === "system");
  const nonSystem = msgs.filter((m) => m.role !== "system");
  const pinned = extractPinnedMessages(nonSystem, pinnedTask);
  const compactable = nonSystem.filter((m) => !pinned.has(m));
  let start = Math.max(0, compactable.length - keepRecent);
  start = alignCompactionStart(compactable, start);
  const recent = compactable.slice(start);
  const older = compactable.slice(0, start);
  if (older.length === 0) return null;
  return { system, pinnedList: nonSystem.filter((m) => pinned.has(m)), recent, older };
}

async function buildCompactionSummary(opts: {
  provider?: LlmProvider;
  model?: string;
  older: Message[];
  pinnedTask?: string;
  signal?: AbortSignal;
}): Promise<string> {
  if (opts.provider) {
    return summarizeWithLlm({
      provider: opts.provider,
      model: opts.model,
      older: opts.older,
      pinnedTask: opts.pinnedTask,
      signal: opts.signal,
    });
  }
  return summarizeMessagesHeuristic(opts.older);
}

async function finalizeCompaction(
  options: {
    pinnedTask?: string;
    contextWindow?: number;
    force?: boolean;
    onCompaction?: (info: CompactionInfo) => void | Promise<void>;
  },
  split: {
    system: Message[];
    pinnedList: Message[];
    recent: Message[];
    older: Message[];
  },
  summary: string,
): Promise<Message[]> {
  const pin = options.pinnedTask ? `Pinned original task:\n${options.pinnedTask}\n\n` : "";
  const summaryContent = `${COMPACTION_MARKER}\n${pin}${summary}`;

  // The new summary covers the range *after* the pinned messages (which include
  // earlier summaries), so it belongs between them and the verbatim tail.
  const result = normalizeToolHistory([
    ...split.system,
    ...split.pinnedList,
    { role: "user", content: summaryContent },
    ...split.recent,
  ]);

  await options.onCompaction?.({
    trigger: options.force ? "manual" : options.contextWindow ? "hard_limit" : "soft_limit",
    messagesSummarized: split.older.length,
    messagesKept: split.recent.length,
    tokensBefore: estimateTokens(split.older),
    tokensAfter: estimateTokens([{ role: "user", content: summaryContent }]),
  });

  return result;
}

/** Sync wrapper for callers that cannot await (tests / CLI smoke). */
export function compactHistorySync(history: Message[], pinnedTask?: string): Message[] {
  const lossless = compactHistoryLossless(history);
  if (lossless.length <= HISTORY_HARD_LIMIT) return lossless;
  const msgs = maskOldObservations(lossless);
  const system = msgs.filter((m) => m.role === "system");
  const nonSystem = msgs.filter((m) => m.role !== "system");
  let start = Math.max(0, nonSystem.length - KEEP_RECENT);
  start = alignCompactionStart(nonSystem, start);
  const recent = nonSystem.slice(start);
  const older = nonSystem.slice(0, start);
  if (older.length === 0) return msgs;
  const pin = pinnedTask ? `Pinned original task:\n${pinnedTask}\n\n` : "";
  return normalizeToolHistory([
    ...system,
    {
      role: "user",
      content: `${COMPACTION_MARKER}\n${pin}${summarizeMessagesHeuristic(older)}`,
    },
    ...recent,
  ]);
}

/**
 * Free-form summaries lose the specifics an agent needs to resume work. Fixed
 * sections force the model to carry the facts forward — paths, decisions,
 * errors, remaining steps — instead of narrating what happened.
 */
const SUMMARY_INSTRUCTIONS = [
  "You compress the history of a coding-agent session so the agent can resume without the transcript.",
  "Output exactly these sections, in this order, with these headings and nothing else:",
  "",
  "## Intent",
  "The user's goal and any stated constraint, kept verbatim where it is a requirement.",
  "## Files touched",
  "One line per file: workspace-relative path — what changed in it, or what was learned from it.",
  "## Decisions",
  "Each choice made and why, so it is not revisited.",
  "## Errors",
  "Failures encountered and what they revealed. Quote short error strings exactly.",
  "## Next steps",
  "What remains to do, as an ordered list.",
  "",
  "Rules: keep file paths, symbol names, commands and error strings exact.",
  "Drop tool output dumps, narration and anything already reflected in the code.",
  "Write \"None\" under a section that has nothing.",
].join("\n");

async function summarizeWithLlm(opts: {
  provider: LlmProvider;
  model?: string;
  older: Message[];
  pinnedTask?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcript = summarizeMessagesHeuristic(opts.older);
  if (opts.signal?.aborted) return transcript;
  try {
    const completion = await opts.provider.complete({
      model: opts.model,
      maxTokens: SUMMARY_MAX_TOKENS,
      temperature: 0,
      signal: opts.signal,
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTIONS },
        {
          role: "user",
          content: `${opts.pinnedTask ? `Original task: ${opts.pinnedTask}\n\n` : ""}Transcript to compress:\n${transcript}`,
        },
      ],
    });
    return completion.text.trim() || transcript;
  } catch {
    return transcript;
  }
}

function summarizeMessagesHeuristic(messages: Message[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "user") lines.push(`User: ${m.content.slice(0, 200)}`);
    else if (m.role === "assistant") {
      const tools = m.toolCalls?.map((t) => t.name).join(", ");
      lines.push(
        `Assistant: ${m.content.slice(0, 150)}${tools ? ` [tools: ${tools}]` : ""}`,
      );
    } else if (m.role === "tool") {
      lines.push(`Tool(${m.name ?? "?"}): ${m.content.slice(0, 100)}`);
    }
  }
  return lines.slice(-40).join("\n");
}

/** Pin earlier summaries, the original task, and user-stated constraints. */
function extractPinnedMessages(history: Message[], pinnedTask?: string): Set<Message> {
  const pinned = new Set<Message>();

  for (const m of history) {
    if (isCompactionMessage(m)) {
      pinned.add(m);
      continue;
    }
    if (m.role !== "user" || !pinnedTask) continue;
    if (m.content.includes(pinnedTask.slice(0, Math.min(80, pinnedTask.length)))) {
      pinned.add(m);
    }
    if (/must not|do not|never|required|constraint/i.test(m.content)) {
      pinned.add(m);
    }
  }
  return pinned;
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
