import type { LlmProvider, Message, TokenUsage } from "@ninjacode/providers";
import { findModelAnywhere } from "@ninjacode/providers";
import {
  compactResult,
  computeCompactionLimits,
  resolveCompactionTrigger,
  shouldSkipCompaction,
  type CompactHistoryResult,
  type CompactionTrigger,
} from "./compactionGate.js";
import {
  buildStructuredCheckpoint,
  CHECKPOINT_INSTRUCTIONS,
  type CompactionRecoveryReferences,
} from "./compactionCheckpoint.js";
import { estimateTokens } from "./contextEstimate.js";
import { maskOldObservations } from "./observationMasking.js";
import { alignCompactionStart, normalizeToolHistory } from "./toolHistory.js";
import { softenSupersededReads } from "./toolAnnotations.js";
import { stubSupersededVolatileContext } from "./volatileContext.js";

export { softenSupersededReads } from "./toolAnnotations.js";

const TOOL_OUTPUT_MAX = 8_000;
/** Matches packages/tools READ_FILE_MAX_CHARS so harness never re-truncates a clean read. */
const READ_FILE_OUTPUT_MAX = 40_000;
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
  trigger: CompactionTrigger;
  /** Messages folded into the summary. */
  messagesSummarized: number;
  /** Messages kept verbatim (recent tail + system). */
  messagesKept: number;
  /** Estimated tokens in the summarized messages before compaction. */
  tokensBefore: number;
  /** Estimated tokens of the resulting summary message. */
  tokensAfter: number;
  /** Model actually used, or `heuristic` for the guarded local fallback. */
  model: string;
  /** Provider usage for this compaction call, tracked separately by BudgetTracker. */
  usage?: TokenUsage;
  /** Wall-clock duration of the compaction call. */
  durationMs: number;
  /** Whether provider-native compaction was used. */
  native: boolean;
  /** Whether the provider failed and the local heuristic was used. */
  fallback: boolean;
  /** Why the summarizer was not used — absent when it worked. */
  fallbackReason?: string;
  /** Messages the summarizer never saw because its own window was too small. */
  droppedFromTranscript: number;
}

/**
 * Full compaction pipeline. When over hard limit, optionally summarize older turns via LLM.
 */
export async function compactHistory(options: {
  history: Message[];
  pinnedTask?: string;
  provider?: LlmProvider;
  model?: string;
  budgetModel?: string;
  contextWindow?: number;
  systemTokens?: number;
  toolTokens?: number;
  reservedOutputTokens?: number;
  safetyMarginTokens?: number;
  signal?: AbortSignal;
  force?: boolean;
  recoveryReferences?: CompactionRecoveryReferences;
  onCompaction?: (info: CompactionInfo) => void | Promise<void>;
}): Promise<CompactHistoryResult> {
  const original = options.history;
  const msgs = compactHistoryLossless(original);
  const limits = computeCompactionLimits(options.contextWindow, { reservedOutputTokens: options.reservedOutputTokens, safetyMarginTokens: options.safetyMarginTokens });
  const gate = {
    force: options.force,
    systemTokens: options.systemTokens,
    toolTokens: options.toolTokens,
    model: options.budgetModel ?? options.model,
  };

  if (shouldSkipCompaction(msgs, limits, gate)) return compactResult(original, msgs);

  // Under pressure, spend the free tier first: mask only outputs whose exact
  // bytes are recoverable from immutable artifacts.
  // A forced compaction is a request for a summary, so it skips the shortcut.
  const masked = maskOldObservations(msgs);
  if (!options.force && shouldSkipCompaction(masked, limits, gate)) {
    return compactResult(original, masked);
  }

  const recentTokenBudget =
    limits.targetTokens > 0
      ? Math.max(
          256,
          limits.targetTokens -
            (options.systemTokens ?? 0) -
            (options.toolTokens ?? 0) -
            SUMMARY_MAX_TOKENS,
        )
      : 0;
  const split = splitHistoryForCompaction(
    masked,
    limits.keepRecent,
    recentTokenBudget,
    options.budgetModel ?? options.model,
  );
  if (!split) return compactResult(original, msgs);

  const summary = await buildCompactionSummary({
    provider: options.provider,
    model: options.model,
    older: split.older,
    pinnedTask: options.pinnedTask,
    signal: options.signal,
  });
  const trigger = resolveCompactionTrigger(masked, limits, gate);
  const result = await finalizeCompaction(options, split, summary, trigger);
  return compactResult(original, result, true);
}

function splitHistoryForCompaction(
  msgs: Message[],
  keepRecent: number,
  recentTokenBudget: number,
  model?: string,
): {
  system: Message[];
  recent: Message[];
  older: Message[];
} | null {
  const system = msgs.filter((m) => m.role === "system");
  const nonSystem = msgs.filter((m) => m.role !== "system");
  const priorSummaries = nonSystem.filter(isCompactionMessage);
  const compactable = nonSystem.filter((m) => !isCompactionMessage(m));
  const start =
    recentTokenBudget > 0
      ? recentTailStart(compactable, recentTokenBudget, model)
      : alignCompactionStart(compactable, Math.max(0, compactable.length - keepRecent));
  const recent = compactable.slice(start);
  const older = [...priorSummaries, ...compactable.slice(0, start)];
  if (older.length === 0) return null;
  return { system, recent, older };
}

function recentTailStart(messages: Message[], budget: number, model?: string): number {
  let accepted = messages.length;
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    const candidate = alignCompactionStart(messages, cursor);
    if (candidate >= accepted) continue;
    if (estimateTokens(messages.slice(candidate), model) > budget) break;
    accepted = candidate;
    cursor = candidate;
  }
  return accepted;
}

async function buildCompactionSummary(opts: {
  provider?: LlmProvider;
  model?: string;
  older: Message[];
  pinnedTask?: string;
  signal?: AbortSignal;
}): Promise<CompactionSummary> {
  if (opts.provider) {
    return summarizeWithLlm({
      provider: opts.provider,
      model: opts.model,
      older: opts.older,
      pinnedTask: opts.pinnedTask,
      signal: opts.signal,
    });
  }
  const startedAt = Date.now();
  return {
    text: buildStructuredCheckpoint({
      messages: opts.older,
      pinnedTask: opts.pinnedTask,
    }),
    model: "heuristic",
    durationMs: Date.now() - startedAt,
    native: false,
    fallback: true,
    fallbackReason: "no summarizer provider configured",
    droppedFromTranscript: 0,
  };
}

async function finalizeCompaction(
  options: {
    pinnedTask?: string;
    recoveryReferences?: CompactionRecoveryReferences;
    onCompaction?: (info: CompactionInfo) => void | Promise<void>;
  },
  split: {
    system: Message[];
    recent: Message[];
    older: Message[];
  },
  summary: CompactionSummary,
  trigger: CompactionTrigger,
): Promise<Message[]> {
  const checkpoint = buildStructuredCheckpoint({
    messages: split.older,
    summary: summary.text,
    pinnedTask: options.pinnedTask,
    references: options.recoveryReferences,
  });
  const summaryContent = `${COMPACTION_MARKER}\n${checkpoint}`;

  // Every prior summary is input to this compaction and replaced atomically.
  // Therefore the model view contains exactly one canonical summary.
  const result = normalizeToolHistory([
    ...split.system,
    { role: "user", content: summaryContent },
    ...split.recent,
  ]);

  await options.onCompaction?.({
    trigger,
    messagesSummarized: split.older.length,
    messagesKept: split.recent.length,
    tokensBefore: estimateTokens(split.older, summary.model),
    tokensAfter: estimateTokens([{ role: "user", content: summaryContent }], summary.model),
    model: summary.model,
    usage: summary.usage,
    durationMs: summary.durationMs,
    native: summary.native,
    fallback: summary.fallback,
    fallbackReason: summary.fallbackReason,
    droppedFromTranscript: summary.droppedFromTranscript,
  });

  return result;
}

interface CompactionSummary {
  text: string;
  model: string;
  usage?: TokenUsage;
  durationMs: number;
  native: boolean;
  fallback: boolean;
  fallbackReason?: string;
  droppedFromTranscript: number;
}

function summarizerRequest(opts: {
  model?: string;
  pinnedTask?: string;
  signal?: AbortSignal;
  transcript: string;
}): import("@ninjacode/providers").CompletionRequest {
  const task = opts.pinnedTask ? `Original task: ${opts.pinnedTask}\n\n` : "";
  return {
    model: opts.model,
    maxTokens: SUMMARY_MAX_TOKENS,
    temperature: 0,
    signal: opts.signal,
    messages: [
      { role: "system", content: CHECKPOINT_INSTRUCTIONS },
      { role: "user", content: `${task}Transcript to compress:\n${opts.transcript}` },
    ],
  };
}

async function summarizeWithLlm(opts: {
  provider: LlmProvider;
  model?: string;
  older: Message[];
  pinnedTask?: string;
  signal?: AbortSignal;
}): Promise<CompactionSummary> {
  if (opts.signal?.aborted) throw abortError(opts.signal);
  const startedAt = Date.now();
  const { transcript, dropped } = serializeCompactionSegment(
    opts.older,
    compactionTranscriptBudget(opts.model),
    opts.model,
  );
  try {
    const native = typeof opts.provider.compactContext === "function";
    const request = summarizerRequest({ ...opts, transcript });
    const completion = native
      ? await opts.provider.compactContext!(request)
      : await opts.provider.complete(request);
    const empty = completion.text.trim().length === 0;
    return {
      text:
        completion.text.trim() ||
        buildStructuredCheckpoint({ messages: opts.older, pinnedTask: opts.pinnedTask }),
      model: completion.resolvedModel ?? completion.model ?? opts.model ?? opts.provider.name,
      usage: completion.usage,
      durationMs: Date.now() - startedAt,
      native,
      fallback: empty,
      fallbackReason: empty ? "summarizer returned an empty response" : undefined,
      droppedFromTranscript: dropped,
    };
  } catch (error) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    return {
      text: buildStructuredCheckpoint({
        messages: opts.older,
        pinnedTask: opts.pinnedTask,
      }),
      model: opts.model ?? opts.provider.name,
      durationMs: Date.now() - startedAt,
      native: false,
      fallback: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
      droppedFromTranscript: dropped,
    };
  }
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(String(signal.reason ?? "Compaction aborted"), "AbortError");
}

/** Used when the summarizer model is not in the catalog. */
const FALLBACK_COMPACTION_WINDOW = 128_000;

/**
 * The summarizer is an LLM call like any other, so its input must fit its own
 * window. An oversized transcript comes back as a provider error, and the local
 * fallback then hides that behind a summary nobody asked for — so the transcript
 * is trimmed up front instead.
 */
export function compactionTranscriptBudget(model: string | undefined): number {
  const window = (model ? findModelAnywhere(model)?.contextWindow : undefined) ??
    FALLBACK_COMPACTION_WINDOW;
  const instructions = estimateTokens([{ role: "system", content: CHECKPOINT_INSTRUCTIONS }], model);
  return Math.max(1_000, Math.floor(window * 0.9) - SUMMARY_MAX_TOKENS - instructions);
}

function compactionLine(message: Message, index: number): string {
  return JSON.stringify({
    index,
    role: message.role,
    name: message.name,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls,
    content: message.content,
    attachments: message.parts?.map((part) => part.type),
  });
}

/**
 * Prior checkpoints are the densest thing in the segment, so they are never the
 * part that gets dropped; the remaining budget is then filled from the newest
 * message backwards, because recent turns are what the tail needs to make sense.
 */
function serializeCompactionSegment(
  messages: Message[],
  budgetTokens: number,
  model?: string,
): { transcript: string; dropped: number } {
  const lines = messages.map(compactionLine);
  const pinned: string[] = [];
  const rest: string[] = [];
  messages.forEach((message, index) => {
    (isCompactionMessage(message) ? pinned : rest).push(lines[index]!);
  });

  const asMessage = (content: string): Message[] => [{ role: "user", content }];
  let remaining = budgetTokens - estimateTokens(asMessage(pinned.join("\n")), model);
  const sizes = rest.map((line) => estimateTokens(asMessage(line), model));

  let start = rest.length;
  while (start > 0 && remaining - sizes[start - 1]! >= 0) {
    start -= 1;
    remaining -= sizes[start]!;
  }

  // A single message larger than the whole budget still has to say something.
  const oversized = start === rest.length && rest.length > 0;
  const kept = oversized
    ? [rest[rest.length - 1]!.slice(0, Math.max(1, budgetTokens) * 4)]
    : rest.slice(start);
  const dropped = rest.length - kept.length;
  const notice =
    dropped > 0
      ? [`[${dropped} older message(s) omitted: they exceed the summarizer's context window.]`]
      : [];
  return { transcript: [...notice, ...pinned, ...kept].join("\n"), dropped };
}

