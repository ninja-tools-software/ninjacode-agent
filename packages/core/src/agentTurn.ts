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
import { editProgressWarning, hasMutatedWorkspace } from "./editProgress.js";
import { repeatedReadWarning } from "./readChurn.js";
import type { AgentTurnDeps, AgentTurnOutcome } from "./agentTurnTypes.js";

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

  const guidance = [
    repeatedReadWarning(state.history),
    editProgressWarning({
      turn: deps.turn + 1,
      maxTurns: deps.maxTurns,
      mutated: hasMutatedWorkspace(state.history),
    }),
  ].filter((line): line is string => line !== undefined);
  if (guidance.length > 0) {
    state.history.push({ role: "user", content: `[System] ${guidance.join(" ")}` });
  }

  await deps.persist();
  return { kind: "continue" };
}
