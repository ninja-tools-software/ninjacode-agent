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

export type { AgentTurnDeps, AgentTurnMutableState } from "./agentTurnTypes.js";
export { buildUserMessageContent, dropOrphanUserMessage } from "./agentTurnLlm.js";

export async function runAgentTurn(deps: AgentTurnDeps): Promise<AgentTurnOutcome> {
  const blocked = await checkTurnPreconditions(deps);
  if (blocked) return blocked;

  await syncVolatileContext(deps);
  await deps.emit("thinking", { turn: deps.turn + 1 });

  const messages = await prepareTurnMessages(deps);
  const llmResult = await callLlmForTurn(deps, messages, deps.toolSpecs);
  if ("kind" in llmResult) return llmResult;

  const { completion } = llmResult;
  if (!wantsTools(completion)) {
    return handleCompletionWithoutTools(deps, completion);
  }

  return handleToolTurn(deps, completion);
}

/** True when this turn successfully wrote the plan (plan mode hard-stop signal). */
export function successfulWritePlan(invocations: ToolInvocation[]): boolean {
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
    state.history.push({ role: "user", content: `[System] ${loop.message}` });
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

  const guidance = [
    repeatedReadWarning(state.history),
    editProgressWarning({
      turn: deps.turn + 1,
      maxTurns: deps.maxTurns,
      mutated: progressMutated(deps),
      goal: progressGoal(deps),
    }),
  ].filter((line): line is string => line !== undefined);
  if (guidance.length > 0) {
    state.history.push({ role: "user", content: `[System] ${guidance.join(" ")}` });
  }

  await deps.persist();
  return { kind: "continue" };
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
