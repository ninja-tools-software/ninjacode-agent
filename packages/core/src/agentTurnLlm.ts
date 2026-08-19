import type {
  Completion,
  CompletionRequest,
  ContentPart,
  Message,
  StreamSink,
  ToolSpec,
} from "@ninjacode/providers";
import path from "node:path";
import { gatewayErrorInfo } from "@ninjacode/providers";
import { toolOutputLimit, truncateToolOutput, type CompactionInfo } from "./context.js";
import { buildContextView } from "./contextViewBuilder.js";
import {
  estimateContextUsage,
  estimateTokens,
  recordTokenCalibration,
  tokenCalibrationMultiplier,
} from "./contextEstimate.js";
import {
  buildVolatileContextDelta,
  buildVolatileContextMessage,
  volatileContextChanged,
} from "./volatileContext.js";
import type { AgentTurnDeps, AgentTurnOutcome } from "./agentTurnTypes.js";
import { abortReasonMessage } from "./agentRuntime.js";
import { startSpan } from "./telemetry.js";
import { isRetryableLlmError, isRetryWrappedProvider } from "./reliability.js";
import {
  createLlmTurnStallGuard,
  decideAfterStall,
  effectiveRequestTimeoutMs,
  isLlmTurnStallError,
  type LlmTurnStallError,
} from "./llmTurnGuard.js";

/** Enough to characterise the current pace without letting one outlier dominate. */
const RECENT_TURN_SAMPLES = 3;

export class ContextBudgetError extends Error {
  readonly code = "context_budget_exceeded";
  readonly retryable = false;
  readonly blame = "harness";
  readonly recoveryHint = "Reduce or compact context before starting another LLM turn.";

  constructor(
    readonly estimatedTokens: number,
    readonly inputBudget: number,
    readonly reservedOutputTokens: number,
    readonly safetyMarginTokens: number,
  ) {
    super(
      `Context input budget exceeded (~${estimatedTokens}/${inputBudget} tokens after reserving ` +
        `${reservedOutputTokens} output + ${safetyMarginTokens} safety).`,
    );
    this.name = "ContextBudgetError";
  }
}

export async function checkTurnPreconditions(deps: AgentTurnDeps): Promise<AgentTurnOutcome | null> {
  if (deps.signal.aborted) {
    await deps.persist();
    await deps.setState("stopped");
    return { kind: "stopped", message: abortReasonMessage(deps.signal) };
  }

  const timeoutReason = deps.checkRunTimeout();
  if (timeoutReason) {
    await deps.emit("error", { message: timeoutReason });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: timeoutReason };
  }

  // Hitting the budget is a deliberate stop, not a failure: the work done so far
  // stands, so the run ends cleanly instead of being reported as broken.
  const budgetCheck = deps.budget.check();
  if (!budgetCheck.ok) {
    const message = `Stopped on budget: ${budgetCheck.reason}`;
    await deps.emit("status", { text: message });
    await deps.persist();
    await deps.setState("stopped");
    return { kind: "stopped", message };
  }

  return null;
}

/**
 * Append the current scratchpad/plan to the history when they changed. The
 * system prompt is never rebuilt mid-run: that would invalidate the cached
 * prefix and re-bill every prior token at full price.
 */
export async function syncVolatileContext(deps: AgentTurnDeps): Promise<void> {
  const { state } = deps;
  const next = { scratchpad: await deps.readScratchpad(), plan: await deps.readActivePlan() };
  if (!volatileContextChanged(state.volatileContext, next)) return;

  const previous = state.volatileContext;
  state.volatileContext = next;
  const message = deps.minimalVolatileContext
    ? buildVolatileContextDelta(previous, next)
    : buildVolatileContextMessage(next);
  if (message) state.history.push(message);
}

async function reportCompaction(deps: AgentTurnDeps, info: CompactionInfo): Promise<void> {
  if (info.usage) {
    deps.trackUsage(info.usage, {
      category: "compaction",
      model: info.model,
      durationMs: info.durationMs,
    });
    await deps.emit("usage", {
      turn: deps.turn + 1,
      usage: info.usage,
      model: info.model,
      category: "compaction",
    });
  }
  await deps.archiveCompaction(deps.state.history, { ...info });
  await deps.emit("compaction", info);
  // A silent fallback looks like a successful compaction while losing the
  // structure the summarizer was supposed to produce.
  if (info.fallbackReason) {
    deps.logAgentEvent(
      "error",
      `compaction fell back to a local summary: ${info.fallbackReason}`,
      `model=${info.model} dropped=${info.droppedFromTranscript}`,
    );
  }
  startSpan("compaction", {
    model: info.model,
    durationMs: info.durationMs,
    native: info.native,
    fallback: info.fallback,
    fallbackReason: info.fallbackReason,
    droppedFromTranscript: info.droppedFromTranscript,
  }).end();
}

export async function prepareTurnMessages(deps: AgentTurnDeps): Promise<Message[]> {
  const { state } = deps;
  const systemTokens = estimateTokens(
    [{ role: "system", content: state.system }],
    deps.model,
  );
  const toolTokens = deps.toolSpecs.length
    ? estimateTokens([{ role: "system", content: JSON.stringify(deps.toolSpecs) }], deps.model)
    : 0;

  const { messages: compacted, changed } = await buildContextView({
    history: state.history,
    workspaceRoot: deps.workspaceRoot,
    activeFiles: await activeFilesForContext(deps),
    pinnedTask: deps.pinnedTask,
    provider: deps.provider,
    model: deps.utilityModel ?? deps.model,
    budgetModel: deps.model,
    contextWindow: deps.contextWindow,
    systemTokens,
    toolTokens,
    reservedOutputTokens: deps.maxTokens,
    signal: deps.signal,
    onCompaction: (info) => reportCompaction(deps, info),
  });
  if (changed) state.history = compacted;

  const usage = deps.estimateUsage(state.system, compacted, deps.toolSpecs);
  await deps.emit("context_usage", usage);
  await enforceContextBudget(deps, usage);

  return [{ role: "system", content: state.system }, ...compacted];
}

export async function activeFilesForContext(deps: AgentTurnDeps): Promise<string[]> {
  const files = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string") {
      const normalized = normalizeActiveFile(deps.workspaceRoot, value);
      if (normalized) files.add(normalized);
    }
    if (Array.isArray(value)) {
      for (const item of value) add(item);
    }
  };
  add([...deps.modifiedFiles]);
  for (const message of deps.state.history) {
    if (message.role !== "user") continue;
    add(mentionedPaths(message.content));
  }
  for (const turn of deps.state.turns) {
    for (const invocation of turn.toolInvocations) {
      add(invocation.toolCall.arguments.path);
      add(invocation.toolCall.arguments.paths);
      add(invocation.meta?.path);
      add(invocation.meta?.paths);
    }
  }
  try {
    add(await deps.activeFilesProvider?.());
  } catch {
    // Host context is advisory; a closed editor or non-git folder is harmless.
  }
  return [...files];
}

function mentionedPaths(content: string): string[] {
  const paths: string[] = [];
  const pattern =
    /(?:@|`)([^`\s]+)|(?:^|\s|\(|"|'|\[)((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+)/gmu;
  for (const match of content.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (value) paths.push(value);
  }
  return paths;
}

function normalizeActiveFile(workspaceRoot: string, value: string): string | undefined {
  let candidate = value
    .trim()
    .replace(/^file:\/\//u, "")
    .replace(/[),.;'"\]}]+$/u, "")
    .replace(/:\d+(?::\d+)?(?:-\d+)?$/u, "");
  if (!candidate) return undefined;
  if (path.isAbsolute(candidate)) {
    const relative = path.relative(workspaceRoot, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) return undefined;
    candidate = relative;
  }
  candidate = candidate.replace(/^\.\//u, "").replace(/\\/g, "/");
  if (
    !candidate ||
    candidate === ".." ||
    candidate.startsWith("../") ||
    candidate.includes("\0") ||
    !candidate.includes(".")
  ) {
    return undefined;
  }
  return candidate;
}

async function enforceContextBudget(
  deps: AgentTurnDeps,
  usage: ReturnType<AgentTurnDeps["estimateUsage"]>,
): Promise<void> {
  if (usage.inputBudget > 0 && usage.total > usage.inputBudget) {
    const error = new ContextBudgetError(
      usage.total,
      usage.inputBudget,
      usage.output,
      usage.safetyMargin,
    );
    await deps.emit("error", {
      message: error.message,
      code: error.code,
      retryable: error.retryable,
      blame: error.blame,
      recoveryHint: error.recoveryHint,
    });
    throw error;
  }

  if (usage.inputBudget > 0 && usage.total > Math.floor(usage.inputBudget * 0.85)) {
    await deps.emit("status", {
      text: `Context input budget nearly full (~${usage.total}/${usage.inputBudget} tokens). Compacting or finishing soon.`,
    });
  }
}

/**
 * `onVisibleOutput` fires only for events the user has already seen. Replaying a
 * turn after that would print the same tokens twice, which is what forbids the
 * retry — usage and tool-call bookkeeping carry no such cost.
 */
function createStreamSink(deps: AgentTurnDeps, onVisibleOutput?: () => void): StreamSink {
  return async (event) => {
    if (event.type === "text_delta") {
      onVisibleOutput?.();
      await deps.emit("text_delta", { text: event.text });
    } else if (event.type === "reasoning_delta") {
      onVisibleOutput?.();
      await deps.emit("reasoning_delta", { text: event.text });
    } else if (event.type === "routing") {
      await deps.emit("routing", {
        model: event.model,
        label: event.label,
        reason: event.reason,
        tier: event.tier,
        estimatedCredits: event.estimatedCredits,
      });
    }
  };
}

function turnRequest(
  deps: AgentTurnDeps,
  messages: Message[],
  toolSpecs: ToolSpec[],
): CompletionRequest {
  return {
    messages,
    tools: toolSpecs,
    maxTokens: deps.maxTokens,
    model: deps.model,
    cacheSystemPrompt: deps.enablePromptCache,
    reasoningEffort: deps.reasoningEffort,
    thinkingBudgetTokens: deps.thinkingBudgetTokens,
    signal: deps.signal,
  };
}

export async function callLlmForTurn(
  deps: AgentTurnDeps,
  messages: Message[],
  toolSpecs: ToolSpec[],
): Promise<{ completion: Completion } | AgentTurnOutcome> {
  const { turn } = deps;
  let emitted = false;
  const sink = createStreamSink(deps, () => (emitted = true));
  logLlmCall(deps, messages.length);
  const llmStarted = Date.now();

  try {
    const system = messages[0]?.role === "system" ? messages[0].content : "";
    const history = messages[0]?.role === "system" ? messages.slice(1) : messages;
    const estimated = estimateContextUsage({
      system,
      history,
      tools: toolSpecs,
      model: deps.model,
    });
    const llmSpan = startSpan("llm", {
      turn: turn + 1,
      provider: deps.provider.name,
      model: deps.model,
    });
    const completion = await completeTurnSafely({
      provider: deps.provider,
      request: turnRequest(deps, messages, toolSpecs),
      sink,
      signal: deps.signal,
      hasEmitted: () => emitted,
      stall: {
        requestTimeoutMs: effectiveRequestTimeoutMs(
          deps.llmTurnStall.requestTimeoutMs,
          deps.remainingRunMs(),
        ),
        streamIdleTimeoutMs: deps.llmTurnStall.streamIdleTimeoutMs,
      },
    });
    const durationMs = Date.now() - llmStarted;
    await recordCompletedTurn(deps, completion, estimated, llmSpan, durationMs);
    return { completion };
  } catch (e) {
    // Every exit carries the wall clock it consumed: a turn that burned minutes
    // and produced nothing is otherwise a silent gap in the trajectory.
    const durationMs = Date.now() - llmStarted;
    startSpan("llm", { turn: turn + 1, failed: true }).end();
    if (isLlmTurnStallError(e)) return handleStalledTurn(deps, e, durationMs);
    if (deps.isAbortError(e)) {
      const message = abortReasonMessage(deps.signal);
      deps.logAgentEvent("cancel", `turn ${turn + 1}: ${message} after ${durationMs}ms`);
      await deps.persist();
      await deps.setState("stopped");
      return { kind: "stopped", message };
    }
    const structured = classifyLlmError(e, emitted);
    const msg = structured.message;
    deps.logAgentEvent("error", `turn ${turn + 1}: LLM error after ${durationMs}ms`, msg);
    await deps.emit("error", { ...structured, durationMs, gateway: gatewayErrorInfo(e) });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: `LLM error: ${msg}` };
  }
}

/**
 * A stalled turn streamed nothing, so history is untouched and replaying is both
 * safe and cache-friendly. The retry goes through `checkTurnPreconditions`, so
 * budget, run timeout, and abort are all re-checked before waiting again.
 */
async function handleStalledTurn(
  deps: AgentTurnDeps,
  error: LlmTurnStallError,
  durationMs: number,
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.llmStallRetries += 1;
  const decision = decideAfterStall(state.llmStallRetries, deps.llmTurnStall);
  deps.logAgentEvent("error", `turn ${deps.turn + 1}: ${error.message}`, decision.message);

  // A retried stall still ends the run's clock; recording it as an error event
  // keeps the lost minutes visible even when the next attempt succeeds.
  await deps.emit("error", {
    message: decision.message,
    code: error.code,
    category: `llm_stall_${error.kind}`,
    durationMs,
    retryable: decision.action === "retry",
    blame: "provider",
    recoveryHint: "Check provider status or switch model before retrying this task.",
  });

  if (decision.action === "retry") {
    await deps.emit("status", { text: `${error.message} ${decision.message}` });
    await deps.persist();
    return { kind: "continue" };
  }

  await deps.persist();
  await deps.setState("failed");
  return { kind: "failed", message: decision.message };
}

function logLlmCall(deps: AgentTurnDeps, messageCount: number): void {
  deps.logAgentEvent(
    "llm_call",
    `turn ${deps.turn + 1}: ${deps.provider.name} model=${deps.model ?? "default"} messages=${messageCount}`,
  );
}

async function recordCompletedTurn(
  deps: AgentTurnDeps,
  completion: Completion,
  estimated: ReturnType<typeof estimateContextUsage>,
  llmSpan: ReturnType<typeof startSpan>,
  durationMs: number,
): Promise<void> {
  deps.state.llmStallRetries = 0;
  // What a turn costs is the one budget figure the model cannot observe itself.
  deps.state.recentLlmTurnMs.push(durationMs);
  if (deps.state.recentLlmTurnMs.length > RECENT_TURN_SAMPLES) deps.state.recentLlmTurnMs.shift();
  const resolvedModel = completion.resolvedModel ?? completion.model ?? deps.model;
  const actualInput =
    completion.usage.inputTokens +
    (completion.usage.cacheReadTokens ?? 0) +
    (completion.usage.cacheWriteTokens ?? 0);
  // Calibrate on text only: image tokens are billed by area, so feeding them into
  // a chars/4 ratio would teach the multiplier the wrong lesson.
  recordTokenCalibration(
    resolvedModel,
    (estimated.total - estimated.images) / tokenCalibrationMultiplier(deps.model),
    actualInput - estimated.images,
  );
  deps.trackUsage(completion.usage, { model: resolvedModel });
  await deps.emit("usage", {
    turn: deps.turn + 1,
    usage: completion.usage,
    model: resolvedModel,
    durationMs,
  });
  if (completion.resolvedModel) {
    deps.logAgentEvent(
      "llm_call",
      `turn ${deps.turn + 1}: Auto routed to model=${completion.resolvedModel}`,
    );
  }
  deps.logAgentEvent(
    "llm_response",
    `turn ${deps.turn + 1}: in=${completion.usage.inputTokens} out=${completion.usage.outputTokens} tools=${completion.toolCalls?.length ?? 0}`,
    completion.text,
  );
  if (completion.usage.cacheReadTokens || completion.usage.cacheWriteTokens) {
    deps.logAgentEvent(
      "cache",
      `turn ${deps.turn + 1}: cacheRead=${completion.usage.cacheReadTokens ?? 0} cacheWrite=${completion.usage.cacheWriteTokens ?? 0}`,
    );
  }
  llmSpan.end({
    inputTokens: completion.usage.inputTokens,
    outputTokens: completion.usage.outputTokens,
    tools: completion.toolCalls?.length ?? 0,
  });
}

interface SafeTurnCall {
  provider: AgentTurnDeps["provider"];
  request: CompletionRequest;
  sink: StreamSink;
  signal: AbortSignal;
  hasEmitted: () => boolean;
  stall: { requestTimeoutMs: number; streamIdleTimeoutMs: number };
}

/**
 * A stall is not retried here: it is reported to the turn loop, which owns the
 * consecutive-stall budget. Retrying in both places would double the wait.
 */
async function completeTurnSafely(opts: SafeTurnCall): Promise<Completion> {
  const maxAttempts = isRetryWrappedProvider(opts.provider) ? 1 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (opts.signal.aborted) throw abortError(opts.signal);
    const guard = createLlmTurnStallGuard({
      outerSignal: opts.signal,
      requestTimeoutMs: opts.stall.requestTimeoutMs,
      streamIdleTimeoutMs: opts.stall.streamIdleTimeoutMs,
    });
    try {
      return await opts.provider.completeStreaming(
        { ...opts.request, signal: guard.signal },
        async (event) => {
          guard.noteActivity();
          await opts.sink(event);
        },
      );
    } catch (error) {
      const translated = guard.translate(error);
      const safe =
        !isLlmTurnStallError(translated) &&
        !opts.hasEmitted() &&
        !opts.signal.aborted &&
        isRetryableLlmError(translated) &&
        attempt < maxAttempts;
      if (!safe) throw translated;
      await retryDelay(100, opts.signal);
    } finally {
      guard.dispose();
    }
  }
  throw new Error("LLM turn retry budget exhausted");
}

function classifyLlmError(
  error: unknown,
  emitted: boolean,
): {
  message: string;
  code: string;
  retryable: boolean;
  blame: "provider" | "user";
  recoveryHint: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const aborted = error instanceof Error && error.name === "AbortError";
  const retryExhausted = !aborted && !emitted && isRetryableLlmError(error);
  return {
    message,
    code: aborted ? "aborted" : retryExhausted ? "retry_exhausted" : "llm_error",
    retryable: false,
    blame: aborted ? "user" : "provider",
    recoveryHint: "Do not automatically replay this turn; inspect the provider error.",
  };
}

function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError(signal));
      },
      { once: true },
    );
  });
}

function abortError(signal: AbortSignal): DOMException {
  return new DOMException(signal.reason ? String(signal.reason) : "Aborted", "AbortError");
}

/** Build user message content, respecting model vision support. */
export function buildUserMessageContent(
  text: string,
  images: ContentPart[],
  supportsVision: boolean,
): { content: string; parts: ContentPart[] | undefined } {
  const omittedNote =
    !supportsVision && images.length > 0
      ? `\n\n[${images.length} image attachment(s) omitted — the selected model does not support image input]`
      : "";
  const content = text + omittedNote;
  const parts = supportsVision && images.length > 0 ? images : undefined;
  return { content, parts };
}

/** Drop a trailing orphan user message before re-adding the same content. */
export function dropOrphanUserMessage(history: Message[], content: string): void {
  const last = history.at(-1);
  if (last?.role === "user" && last.content === content && !last.parts) {
    history.pop();
  }
}

export function truncateToolResult(output: string, toolName: string): string {
  return truncateToolOutput(output, toolOutputLimit(toolName));
}
