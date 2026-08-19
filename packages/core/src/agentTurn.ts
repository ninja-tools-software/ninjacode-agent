import { wantsTools } from "@ninjacode/providers";
import {
  appendToolResults,
  evaluateToolLoop,
  handleCompletionWithoutTools,
  recordToolCalls,
} from "./agentTurnCompletion.js";
import {
  callLlmForTurn,
  checkTurnPreconditions,
  prepareTurnMessages,
  syncVolatileContext,
  truncateToolResult,
} from "./agentTurnLlm.js";
import { editProgressWarning, hasMutatedWorkspace, hasWrittenPlan, type ProgressGoal } from "./editProgress.js";
import { repeatedReadWarning } from "./readChurn.js";
import type { AgentTurnDeps, AgentTurnOutcome } from "./agentTurnTypes.js";
import type { ToolInvocation } from "./types.js";
import { startSpan } from "./telemetry.js";
import {
  markAutomaticDelegation,
  observePhaseTurn,
  takeInitialPhaseTransition,
  type PhaseTransition,
} from "./phasePolicy.js";

export type { AgentTurnDeps, AgentTurnMutableState } from "./agentTurnTypes.js";
export { buildUserMessageContent, dropOrphanUserMessage } from "./agentTurnLlm.js";

export async function runAgentTurn(deps: AgentTurnDeps): Promise<AgentTurnOutcome> {
  const turnSpan = startSpan("turn", { turn: deps.turn + 1 });
  const blocked = await checkTurnPreconditions(deps);
  if (blocked) {
    turnSpan.end({ outcome: blocked.kind });
    return blocked;
  }

  try {
    await emitInitialPhase(deps);
    await syncVolatileContext(deps);
    await deps.emit("thinking", { turn: deps.turn + 1 });

    const messages = await prepareTurnMessages(deps);
    const llmResult = await callLlmForTurn(deps, messages, deps.toolSpecs);
    if ("kind" in llmResult) {
      turnSpan.end({ outcome: llmResult.kind });
      return llmResult;
    }

    const { completion } = llmResult;
    await deps.recordSessionEvent("assistant_message", {
      text: completion.text,
      toolCalls: completion.toolCalls,
      stopReason: completion.stopReason,
      usage: completion.usage,
    });
    if (!wantsTools(completion)) {
      const outcome = await handleCompletionWithoutTools(deps, completion);
      turnSpan.end({ outcome: outcome.kind });
      return outcome;
    }

    const outcome = await handleToolTurn(deps, completion);
    turnSpan.end({ outcome: outcome.kind });
    return outcome;
  } catch (error) {
    turnSpan.end({ failed: true });
    throw error;
  }
}

/** True when this turn successfully wrote the plan (plan mode hard-stop signal). */
function successfulWritePlan(invocations: ToolInvocation[]): boolean {
  return invocations.some(
    (inv) => inv.toolCall.name === "write_plan" && inv.approved && !inv.error,
  );
}

async function handleToolTurn(
  deps: AgentTurnDeps,
  completion: import("@ninjacode/providers").Completion,
): Promise<AgentTurnOutcome> {
  const { state } = deps;

  state.history.push({
    role: "assistant",
    content: completion.text,
    toolCalls: completion.toolCalls,
    reasoningBlocks: completion.reasoningBlocks,
  });

  const invocations = await deps.toolPipeline.executeToolCalls(deps.modeTools, completion.toolCalls);

  // Tool results must follow their assistant message directly: anything pushed
  // in between orphans them and they get dropped by `normalizeToolHistory`.
  appendToolResults(state.history, invocations, truncateToolResult);

  state.turns.push({
    turn: state.globalTurn++,
    assistantText: completion.text,
    toolInvocations: invocations,
    usage: completion.usage,
  });

  recordToolCalls(state.toolCallFingerprints, completion.toolCalls);
  const loop = evaluateToolLoop(state.toolCallFingerprints, deps.enableLoopDetection);
  if (loop.action === "warn") {
    await pushGuidance(deps, "loop_detection", loop.message);
  }
  if (loop.action === "stop") {
    await deps.emit("status", { text: loop.message });
    await deps.persist();
    await deps.setState("stopped");
    return { kind: "stopped", message: loop.message };
  }

  // PLAN mode: a successful write_plan ends the run. Same-batch tools (todo_write)
  // already ran; follow-up user messages may call write_plan again to overwrite.
  if (progressGoal(deps) === "plan" && successfulWritePlan(invocations)) {
    const answer = completion.text.trim() || "Plan ready.";
    await deps.persist();
    await deps.emit("done", { answer, cacheStats: deps.getCacheStats() });
    await deps.setState("completed");
    return { kind: "done", answer };
  }

  const adaptive = state.phasePolicy ? await adaptiveGuidance(deps, invocations) : undefined;
  if (adaptive?.terminalFailure) {
    await deps.emit("error", {
      message: adaptive.terminalFailure,
      category: "verification_recovery_exhausted",
    });
    await deps.persist();
    await deps.setState("failed");
    return { kind: "failed", message: adaptive.terminalFailure };
  }
  const calendarGuidance = [
    repeatedReadWarning(state.history),
    editProgressWarning({
      turn: deps.turn + 1,
      maxTurns: deps.maxTurns,
      mutated: progressMutated(deps),
      goal: progressGoal(deps),
    }),
  ].filter((line): line is string => line !== undefined);
  const guidance = adaptive ? [...adaptive.guidance, ...calendarGuidance] : calendarGuidance;
  if (guidance.length > 0) {
    await pushGuidance(deps, "turn_guidance", guidance.join(" "));
  }

  await deps.persist();
  return { kind: "continue" };
}

/**
 * Guidance reaches the model through history only, so without a session event
 * there is no way to tell afterwards whether a nudge fired or what it said.
 */
async function pushGuidance(
  deps: Pick<AgentTurnDeps, "state" | "turn" | "recordSessionEvent">,
  source: "loop_detection" | "turn_guidance",
  text: string,
): Promise<void> {
  deps.state.history.push({ role: "user", content: `[System] ${text}` });
  await deps.recordSessionEvent("system_guidance", { turn: deps.turn + 1, source, text });
}

async function adaptiveGuidance(
  deps: AgentTurnDeps,
  invocations: ToolInvocation[],
): Promise<{ guidance: string[]; terminalFailure?: string }> {
  const policy = deps.state.phasePolicy;
  if (!policy) return { guidance: [] };
  const turn = deps.turn + 1;
  const decision = observePhaseTurn(policy, invocations, turn);
  await emitPhaseTransition(deps, decision.transition);

  if (decision.terminalFailure) {
    return { guidance: [], terminalFailure: decision.terminalFailure };
  }

  const guidance = decision.guidance ? [decision.guidance] : [];
  if (!decision.delegation || !deps.enableSubagents) return { guidance };

  markAutomaticDelegation(policy);
  const { role, reason } = decision.delegation;
  await deps.emit("status", {
    text: `Adaptive ${role} delegation (${reason})`,
  });
  try {
    const summary = await deps.runAdaptiveSubAgent(role, reason);
    guidance.push(
      `[${role} sub-agent, triggered by ${reason}] ${summary.slice(0, 6000)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    guidance.push(
      `Adaptive ${role} delegation failed (${message.slice(0, 500)}). Continue with current evidence; do not retry the same delegation.`,
    );
  }
  return { guidance };
}

async function emitInitialPhase(deps: AgentTurnDeps): Promise<void> {
  const policy = deps.state.phasePolicy;
  if (!policy) return;
  await emitPhaseTransition(deps, takeInitialPhaseTransition(policy));
}

async function emitPhaseTransition(
  deps: Pick<AgentTurnDeps, "emit" | "state">,
  transition: PhaseTransition | undefined,
): Promise<void> {
  const policy = deps.state.phasePolicy;
  if (!policy || !transition) return;
  await deps.emit("phase_change", {
    from: transition.from,
    phase: transition.to,
    turn: transition.turn,
    reason: transition.reason,
    complexity: policy.complexity,
    explorationBudget: policy.explorationBudget,
    mutationCount: policy.mutationCount,
    recoveryCycles: policy.recoveryCycles,
  });
}

function progressGoal(deps: AgentTurnDeps): ProgressGoal | undefined {
  const canEdit = Boolean(
    deps.modeTools.get("edit_file") || deps.modeTools.get("write_file") || deps.modeTools.get("apply_patch"),
  );
  if (canEdit) return "edit";
  if (deps.modeTools.get("write_plan")) return "plan";
  return undefined;
}

function progressMutated(deps: AgentTurnDeps): boolean {
  const goal = progressGoal(deps);
  if (goal === "plan") return hasWrittenPlan(deps.state.history);
  if (goal === "edit") return hasMutatedWorkspace(deps.state.history);
  return true;
}
