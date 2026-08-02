import type { Completion, Message } from "@ninjacode/providers";
import { annotateListDir, annotateReadFile } from "./toolAnnotations.js";
import type { AgentTurnDeps } from "./agentTurnTypes.js";

type AgentTurnOutcome =
  | { kind: "continue" }
  | { kind: "done"; answer: string }
  | { kind: "failed"; message: string }
  | { kind: "stopped"; message: string };

function isEmptyCompletion(completion: Completion): boolean {
  if (completion.toolCalls.length > 0) return false;
  if (completion.text.trim().length > 0) return false;
  if ((completion.reasoning?.trim().length ?? 0) > 0) return false;
  return true;
}

async function retryEmptyResponse(
  deps: AgentTurnDeps,
  state: AgentTurnDeps["state"],
): Promise<AgentTurnOutcome | null> {
  if (state.emptyResponseRetries >= 2) return null;
  state.emptyResponseRetries += 1;
  await deps.emit("status", {
    text: `Empty model response — retrying (${state.emptyResponseRetries}/2)…`,
  });
  await deps.persist();
  return { kind: "continue" };
}

async function handleMaxTokensTruncation(
  deps: AgentTurnDeps,
  completion: Completion,
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.history.push({
    role: "assistant",
    content: completion.text || "(response truncated at max_tokens)",
  });
  state.history.push({
    role: "user",
    content:
      "[System] Your previous response was truncated because it hit the output token limit. Continue from where you left off. If you were writing a file, use write_file or edit_file instead of putting the full content in chat.",
  });
  state.turns.push({
    turn: state.globalTurn++,
    assistantText: completion.text,
    toolInvocations: [],
    usage: completion.usage,
  });
  await deps.persist();
  return { kind: "continue" };
}

async function handleStopHookBlock(
  deps: AgentTurnDeps,
  completion: Completion,
  blocked: { stderr?: string; stdout?: string },
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.stopHookRetries += 1;
  state.history.push({ role: "assistant", content: completion.text });
  state.history.push({
    role: "user",
    content: `[Stop hook] Completion blocked: ${blocked.stderr || blocked.stdout || "no reason given"}. Address this before finishing.`,
  });
  await deps.emit("status", { text: `Stop hook blocked completion (attempt ${state.stopHookRetries}/3)` });
  await deps.persist();
  return { kind: "continue" };
}

async function handleVerificationFailure(
  deps: AgentTurnDeps,
  completion: Completion,
  messages: string[],
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.verificationRetries += 1;
  state.history.push({ role: "assistant", content: completion.text });
  state.history.push({
    role: "user",
    content:
      `[System] Verification failed before completion (attempt ${state.verificationRetries}/3):\n` +
      `${messages.join("\n\n")}\n\nFix the issues and verify before finishing.`,
  });
  await deps.emit("status", { text: "Completion blocked — verification failed" });
  await deps.persist();
  return { kind: "continue" };
}

async function handleSubAgentReview(
  deps: AgentTurnDeps,
  completion: Completion,
  review: string,
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.verificationRetries += 1;
  state.history.push({ role: "assistant", content: completion.text });
  state.history.push({
    role: "user",
    content: `[Verification sub-agent] ${review}\n\nAddress these findings before finishing.`,
  });
  await deps.persist();
  return { kind: "continue" };
}

async function finalizeCompletion(
  deps: AgentTurnDeps,
  completion: Completion,
): Promise<AgentTurnOutcome> {
  const { state } = deps;
  state.turns.push({
    turn: state.globalTurn++,
    assistantText: completion.text,
    toolInvocations: [],
    usage: completion.usage,
  });
  state.history.push({ role: "assistant", content: completion.text });
  await deps.persist();
  await deps.emit("done", {
    answer: completion.text,
    cacheStats: deps.getCacheStats(),
  });
  await deps.setState("completed");
  return { kind: "done", answer: completion.text };
}

export async function handleCompletionWithoutTools(
  deps: AgentTurnDeps,
  completion: Completion,
): Promise<AgentTurnOutcome> {
  const { state } = deps;

  if (isEmptyCompletion(completion)) {
    const retry = await retryEmptyResponse(deps, state);
    if (retry) return retry;
    const msg =
      "Model returned an empty response (no text or tool calls). Check your provider, API key, credits, and model settings.";
    await deps.emit("error", { message: msg });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: msg };
  }

  if (completion.stopReason === "max_tokens") {
    return handleMaxTokensTruncation(deps, completion);
  }

  const stopHooks = await deps.runHooks("Stop", {});
  const blocked = stopHooks.find((r) => r.blocked);
  if (blocked && state.stopHookRetries < 3) {
    return handleStopHookBlock(deps, completion, blocked);
  }

  if (deps.enableCompletionVerification && deps.modifiedFiles.size > 0) {
    const verification = await deps.runCompletionVerification(deps.verifyConfig);
    if (!verification.ok && state.verificationRetries < 3) {
      return handleVerificationFailure(deps, completion, verification.messages);
    }
  }

  if (deps.enableVerificationSubAgent && deps.modifiedFiles.size > 0) {
    const review = await deps.runVerificationSubAgent(completion.text);
    if (review && state.verificationRetries < 2) {
      return handleSubAgentReview(deps, completion, review);
    }
  }

  return finalizeCompletion(deps, completion);
}

/** Recent calls examined for repetition — roughly the last few turns. */
const LOOP_WINDOW = 12;
/** Identical calls that earn a warning. */
const LOOP_WARN_REPEATS = 4;
/** Identical calls that end the run: the warning demonstrably did not land. */
const LOOP_STOP_REPEATS = 7;

type LoopDecision =
  | { action: "none" }
  | { action: "warn"; message: string }
  | { action: "stop"; message: string };

export function recordToolCalls(
  fingerprints: string[],
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): void {
  for (const tc of toolCalls) {
    fingerprints.push(fingerprintToolCall(tc.name, tc.arguments));
  }
}

/**
 * A warning the model ignores is not a termination condition. Past
 * `LOOP_STOP_REPEATS` identical calls the run ends: whatever the model is doing,
 * it is not making progress, and every further turn is paid for nothing.
 */
export function evaluateToolLoop(fingerprints: string[], enabled: boolean): LoopDecision {
  if (!enabled) return { action: "none" };

  const counts = new Map<string, number>();
  for (const fp of fingerprints.slice(-LOOP_WINDOW)) {
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }

  let worst: { fp: string; n: number } | undefined;
  for (const [fp, n] of counts) {
    if (!worst || n > worst.n) worst = { fp, n };
  }
  if (!worst || worst.n < LOOP_WARN_REPEATS) return { action: "none" };

  if (worst.n >= LOOP_STOP_REPEATS) {
    return {
      action: "stop",
      message:
        `Stopping: the same tool call was repeated ${worst.n} times without progress (${worst.fp}). ` +
        "The run was ending turns on a loop rather than advancing the task.",
    };
  }
  return {
    action: "warn",
    message:
      `Repeated identical tool call detected (${worst.n} times): ${worst.fp}. ` +
      "Try a different approach — read a different file, use another tool, or ask the user.",
  };
}

function fingerprintToolCall(name: string, args: Record<string, unknown>): string {
  const stable = JSON.stringify(args, Object.keys(args).sort());
  return `${name}:${stable.slice(0, 240)}`;
}

export function appendToolResults(
  history: Message[],
  invocations: Array<{
    output: string;
    toolCall: { id: string; name: string; arguments: Record<string, unknown> };
    meta?: Record<string, unknown>;
  }>,
  truncate: (output: string, toolName: string) => string,
): void {
  for (const inv of invocations) {
    let content = truncate(inv.output, inv.toolCall.name);
    const pathArg = inv.toolCall.arguments.path;
    if (typeof pathArg === "string") {
      if (inv.toolCall.name === "read_file" && typeof inv.meta?.startLine === "number") {
        content = annotateReadFile(pathArg, content, inv.meta);
      } else if (inv.toolCall.name === "list_dir") {
        content = annotateListDir(pathArg, content, Boolean(inv.toolCall.arguments.recursive));
      }
    }
    history.push({
      role: "tool",
      content,
      toolCallId: inv.toolCall.id,
      name: inv.toolCall.name,
    });
  }
}
