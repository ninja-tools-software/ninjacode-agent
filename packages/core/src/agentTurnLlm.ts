import type {
  Completion,
  ContentPart,
  Message,
  StreamSink,
  ToolSpec,
} from "@ninjacode/providers";
import { gatewayErrorInfo } from "@ninjacode/providers";
import { compactHistory, toolOutputLimit, truncateToolOutput } from "./context.js";
import { buildVolatileContextMessage, volatileContextChanged } from "./volatileContext.js";
import type { AgentTurnDeps } from "./agentTurnTypes.js";

type AgentTurnOutcome =
  | { kind: "continue" }
  | { kind: "failed"; message: string }
  | { kind: "stopped"; message: string };

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
  const systemTokens = Math.ceil(state.system.length / 4);
  const toolTokens = deps.toolSpecs.length ? Math.ceil(JSON.stringify(deps.toolSpecs).length / 4) : 0;

  const { messages: compacted, changed } = await compactHistory({
    history: state.history,
    pinnedTask: deps.pinnedTask,
    provider: deps.provider,
    model: deps.utilityModel ?? deps.model,
    contextWindow: deps.contextWindow,
    systemTokens,
    toolTokens,
    signal: deps.signal,
    onCompaction: (info) => deps.emit("compaction", info),
  });
  if (changed) state.history = compacted;

  const usage = deps.estimateUsage(state.system, compacted, deps.toolSpecs);
  await deps.emit("context_usage", usage);

  if (deps.contextWindow && usage.total > Math.floor(deps.contextWindow * 0.95)) {
    await deps.emit("status", {
      text: `Context window nearly full (~${usage.total}/${deps.contextWindow} tokens). Compacting or finishing soon.`,
    });
  }

  return [{ role: "system", content: state.system }, ...compacted];
}

function createStreamSink(deps: AgentTurnDeps): StreamSink {
  return async (event) => {
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
  const sink = createStreamSink(deps);

  deps.logAgentEvent(
    "llm_call",
    `turn ${turn + 1}: ${deps.provider.name} model=${deps.model ?? "default"} messages=${messages.length}`,
  );

  try {
    const completion = await deps.provider.completeStreaming(
      {
        messages,
        tools: toolSpecs,
        maxTokens: deps.maxTokens,
        model: deps.model,
        cacheSystemPrompt: deps.enablePromptCache,
        reasoningEffort: deps.reasoningEffort,
        thinkingBudgetTokens: deps.thinkingBudgetTokens,
        signal: deps.signal,
      },
      sink,
    );
    deps.trackUsage(completion.usage);
    const resolvedModel = completion.resolvedModel ?? completion.model ?? deps.model;
    await deps.emit("usage", {
      turn: turn + 1,
      usage: completion.usage,
      model: resolvedModel,
    });
    if (completion.resolvedModel) {
      deps.logAgentEvent(
        "llm_call",
        `turn ${turn + 1}: Auto routed to model=${completion.resolvedModel}`,
      );
    }
    deps.logAgentEvent(
      "llm_response",
      `turn ${turn + 1}: in=${completion.usage.inputTokens} out=${completion.usage.outputTokens} tools=${completion.toolCalls?.length ?? 0}`,
      completion.text,
    );
    if (completion.usage.cacheReadTokens || completion.usage.cacheWriteTokens) {
      deps.logAgentEvent(
        "cache",
        `turn ${turn + 1}: cacheRead=${completion.usage.cacheReadTokens ?? 0} cacheWrite=${completion.usage.cacheWriteTokens ?? 0}`,
      );
    }
    return { completion };
  } catch (e) {
    if (deps.isAbortError(e)) {
      deps.logAgentEvent("cancel", `turn ${turn + 1}: LLM call aborted by user`);
      await deps.persist();
      await deps.setState("stopped");
      return { kind: "stopped", message: "Aborted by user." };
    }
    const msg = (e as Error).message;
    deps.logAgentEvent("error", `turn ${turn + 1}: LLM error`, msg);
    await deps.emit("error", { message: msg, gateway: gatewayErrorInfo(e) });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: `LLM error: ${msg}` };
  }
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

export { truncateToolOutput, toolOutputLimit };
