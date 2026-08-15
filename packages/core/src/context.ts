import type { LlmProvider, Message, TokenUsage } from "@ninjacode/providers";
import {
  compactResult,
  computeCompactionLimits,
  resolveCompactionTrigger,
  shouldSkipCompaction,
  type CompactHistoryResult,
  type CompactionTrigger,
} from "./compactionGate.js";
import { estimateTokens } from "./contextEstimate.js";
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
  onCompaction?: (info: CompactionInfo) => void | Promise<void>;
}): Promise<CompactHistoryResult> {
  const original = options.history;
  const msgs = compactHistoryLossless(original);
  const limits = computeCompactionLimits(options.contextWindow, {
    reservedOutputTokens: options.reservedOutputTokens,
    safetyMarginTokens: options.safetyMarginTokens,
  });
  const gate = {
    force: options.force,
    contextWindow: options.contextWindow,
    systemTokens: options.systemTokens,
    toolTokens: options.toolTokens,
    model: options.budgetModel ?? options.model,
  };

  if (shouldSkipCompaction(msgs, limits, gate)) return compactResult(original, msgs);

  // Under pressure, spend the free tier first: masking old re-runnable outputs
  // often buys back enough room that no summary — and no LLM call — is needed.
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
  let start =
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
    text: summarizeMessagesHeuristic(opts.older),
    model: "heuristic",
    durationMs: Date.now() - startedAt,
    native: false,
    fallback: true,
  };
}

async function finalizeCompaction(
  options: {
    pinnedTask?: string;
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
  const pin = options.pinnedTask ? `Pinned original task:\n${options.pinnedTask}\n\n` : "";
  const summaryContent = `${COMPACTION_MARKER}\n${pin}${summary.text}`;

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
  const older = nonSystem.slice(0, start).filter((message) => !isCompactionMessage(message));
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
  "## Task",
  "The user's current goal, kept verbatim where wording is a requirement.",
  "## Constraints",
  "Explicit requirements, prohibitions, compatibility constraints and conflicting instructions with their resolution.",
  "## Files touched",
  "One line per file: workspace-relative path — what changed in it, or what was learned from it.",
  "## Decisions",
  "Each choice made and why, so it is not revisited.",
  "## Validation",
  "Tests, checks and commands already run, including exact failures that remain.",
  "## Open work",
  "What remains to do, in execution order.",
  "## Archives",
  "Artifact IDs and what recoverable raw content each one contains.",
  "",
  "Rules: keep file paths, symbol names, commands and error strings exact.",
  "Drop tool output dumps, narration and anything already reflected in the code.",
  "Write \"None\" under a section that has nothing.",
].join("\n");

interface CompactionSummary {
  text: string;
  model: string;
  usage?: TokenUsage;
  durationMs: number;
  native: boolean;
  fallback: boolean;
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
  const transcript = serializeCompactionSegment(opts.older);
  try {
    const native = typeof opts.provider.compactContext === "function";
    const request: import("@ninjacode/providers").CompletionRequest = {
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
    };
    const completion = native
      ? await opts.provider.compactContext!(request)
      : await opts.provider.complete(request);
    return {
      text: completion.text.trim() || summarizeMessagesHeuristic(opts.older),
      model: completion.resolvedModel ?? completion.model ?? opts.model ?? opts.provider.name,
      usage: completion.usage,
      durationMs: Date.now() - startedAt,
      native,
      fallback: completion.text.trim().length === 0,
    };
  } catch (error) {
    if (opts.signal?.aborted) throw abortError(opts.signal);
    return {
      text: summarizeMessagesHeuristic(opts.older),
      model: opts.model ?? opts.provider.name,
      durationMs: Date.now() - startedAt,
      native: false,
      fallback: true,
    };
  }
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(String(signal.reason ?? "Compaction aborted"), "AbortError");
}

function serializeCompactionSegment(messages: Message[]): string {
  return messages
    .map((message, index) =>
      JSON.stringify({
        index,
        role: message.role,
        name: message.name,
        toolCallId: message.toolCallId,
        toolCalls: message.toolCalls,
        content: message.content,
        attachments: message.parts?.map((part) => part.type),
      }),
    )
    .join("\n");
}

function summarizeMessagesHeuristic(messages: Message[]): string {
  const sample = [
    ...messages.slice(0, 12),
    ...messages.slice(Math.max(12, Math.floor(messages.length / 2) - 6), Math.floor(messages.length / 2) + 6),
    ...messages.slice(-16),
  ].filter((message, index, all) => all.indexOf(message) === index);
  const lines = sample.map((message) => {
    const tools = message.toolCalls?.map((tool) => tool.name).join(", ");
    return `${message.role}${message.name ? `(${message.name})` : ""}: ${message.content.slice(0, 240)}${tools ? ` [tools: ${tools}]` : ""}`;
  });
  const artifacts = messages
    .flatMap((message) => message.content.match(/[a-f0-9]{64}/g) ?? [])
    .filter((id, index, all) => all.indexOf(id) === index);
  return [
    "## Task",
    lines.filter((line) => line.startsWith("user:")).at(0) ?? "None",
    "## Constraints",
    "Provider compaction failed; consult the archived compaction segment for exact constraints.",
    "## Files touched",
    "See archived compaction segment.",
    "## Decisions",
    ...lines.filter((line) => line.startsWith("assistant:")),
    "## Validation",
    ...lines.filter((line) => line.startsWith("tool(")),
    "## Open work",
    lines.at(-1) ?? "None",
    "## Archives",
    artifacts.length > 0 ? artifacts.join("\n") : "See the compaction event artifact.",
  ].join("\n");
}
