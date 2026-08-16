import type {
  Completion,
  CompletionRequest,
  ContentPart,
  Message,
  StreamSink,
  ToolSpec,
} from "@ninjacode/providers";
import { gatewayErrorInfo } from "@ninjacode/providers";
import { toolOutputLimit, truncateToolOutput } from "./context.js";
import { buildContextView } from "./contextViewBuilder.js";
import {
  estimateContextUsage,
  estimateTokens,
  recordTokenCalibration,
  tokenCalibrationMultiplier,
} from "./contextEstimate.js";
import { buildVolatileContextMessage, volatileContextChanged } from "./volatileContext.js";
import type { AgentTurnDeps } from "./agentTurnTypes.js";
import { startSpan } from "./telemetry.js";
import { isRetryableLlmError, isRetryWrappedProvider } from "./reliability.js";

type AgentTurnOutcome =
  | { kind: "continue" }
  | { kind: "failed"; message: string }
  | { kind: "stopped"; message: string };

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
    return { kind: "stopped", message: "Aborted by user." };
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

  state.volatileContext = next;
  const message = buildVolatileContextMessage(next);
  if (message) state.history.push(message);
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
    activeFiles: activeFilesForContext(deps),
    pinnedTask: deps.pinnedTask,
    provider: deps.provider,
    model: deps.utilityModel ?? deps.model,
    budgetModel: deps.model,
    contextWindow: deps.contextWindow,
    systemTokens,
    toolTokens,
    reservedOutputTokens: deps.maxTokens,
    signal: deps.signal,
    onCompaction: async (info) => {
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
      await deps.archiveCompaction(state.history, { ...info });
      await deps.emit("compaction", info);
      startSpan("compaction", {
        model: info.model,
        durationMs: info.durationMs,
        native: info.native,
        fallback: info.fallback,
      }).end();
    },
  });
  if (changed) state.history = compacted;

  const usage = deps.estimateUsage(state.system, compacted, deps.toolSpecs);
  await deps.emit("context_usage", usage);
  await enforceContextBudget(deps, usage);

  return [{ role: "system", content: state.system }, ...compacted];
}

function activeFilesForContext(deps: AgentTurnDeps): string[] {
  const files = new Set(deps.modifiedFiles);
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) files.add(value);
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string" && item.trim()) files.add(item);
    }
  };
  for (const turn of deps.state.turns) {
    for (const invocation of turn.toolInvocations) {
      add(invocation.toolCall.arguments.path);
      add(invocation.toolCall.arguments.paths);
      add(invocation.meta?.path);
      add(invocation.meta?.paths);
    }
  }
  return [...files];
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

function createStreamSink(deps: AgentTurnDeps, onEmission?: () => void): StreamSink {
  return async (event) => {
    onEmission?.();
    if (event.type === "text_delta") {
      await deps.emit("text_delta", { text: event.text });
    } else if (event.type === "reasoning_delta") {
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

export async function callLlmForTurn(
  deps: AgentTurnDeps,
  messages: Message[],
  toolSpecs: ToolSpec[],
): Promise<{ completion: Completion } | AgentTurnOutcome> {
  const { turn } = deps;
  let emitted = false;
  const sink = createStreamSink(deps, () => (emitted = true));
  logLlmCall(deps, messages.length);

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
    const request: CompletionRequest = {
      messages,
      tools: toolSpecs,
      maxTokens: deps.maxTokens,
      model: deps.model,
      cacheSystemPrompt: deps.enablePromptCache,
      reasoningEffort: deps.reasoningEffort,
      thinkingBudgetTokens: deps.thinkingBudgetTokens,
      signal: deps.signal,
    };
    const completion = await completeTurnSafely({
      provider: deps.provider,
      request,
      sink,
      signal: deps.signal,
      hasEmitted: () => emitted,
    });
    await recordCompletedTurn(deps, completion, estimated, llmSpan);
    return { completion };
  } catch (e) {
    startSpan("llm", { turn: turn + 1, failed: true }).end();
    if (deps.isAbortError(e)) {
      deps.logAgentEvent("cancel", `turn ${turn + 1}: LLM call aborted by user`);
      await deps.persist();
      await deps.setState("stopped");
      return { kind: "stopped", message: "Aborted by user." };
    }
    const structured = classifyLlmError(e, emitted);
    const msg = structured.message;
    deps.logAgentEvent("error", `turn ${turn + 1}: LLM error`, msg);
    await deps.emit("error", { ...structured, gateway: gatewayErrorInfo(e) });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: `LLM error: ${msg}` };
  }
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
): Promise<void> {
  const resolvedModel = completion.resolvedModel ?? completion.model ?? deps.model;
  const actualInput =
    completion.usage.inputTokens +
    (completion.usage.cacheReadTokens ?? 0) +
    (completion.usage.cacheWriteTokens ?? 0);
  recordTokenCalibration(
    resolvedModel,
    estimated.total / tokenCalibrationMultiplier(deps.model),
    actualInput,
  );
  deps.trackUsage(completion.usage, { model: resolvedModel });
  await deps.emit("usage", {
    turn: deps.turn + 1,
    usage: completion.usage,
    model: resolvedModel,
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
}

async function completeTurnSafely(opts: SafeTurnCall): Promise<Completion> {
  const maxAttempts = isRetryWrappedProvider(opts.provider) ? 1 : 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (opts.signal.aborted) throw abortError(opts.signal);
    try {
      return await opts.provider.completeStreaming(opts.request, opts.sink);
    } catch (error) {
      const safe =
        !opts.hasEmitted() &&
        !opts.signal.aborted &&
        isRetryableLlmError(error) &&
        attempt < maxAttempts;
      if (!safe) throw error;
      await retryDelay(100, opts.signal);
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
