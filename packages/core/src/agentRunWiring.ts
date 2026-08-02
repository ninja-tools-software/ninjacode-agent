import type { Message } from "@ninjacode/providers";
import type { AgentTaskInput } from "./agentOptions.js";
import { prepareRunLoop, executeTurnLoop, type RunLoopPrepareInput } from "./agentRunLoop.js";
import { buildAgentTurnDeps, type TurnHostInput } from "./agentTurnBridge.js";
import type { AgentOutcome, RequestCheckpoint, RunState, TurnTrace } from "./types.js";
import type { AgentTurnMutableState } from "./agentTurn.js";
import type { ToolPipeline } from "./toolPipeline.js";

export async function runAgentMainLoop(opts: {
  maxTurns: number;
  task: AgentTaskInput;
  prior: Message[];
  debugLogUrl?: string;
  prepareInput: RunLoopPrepareInput;
  turnHost: () => TurnHostInput;
  newToolPipeline: () => ToolPipeline;
  signal: AbortSignal;
  onPrepared: (prepared: {
    turnState: AgentTurnMutableState;
    pinnedTask: string;
    requests: RequestCheckpoint[];
  }) => void;
  onGlobalTurn: (turn: number) => void;
  persist: () => Promise<void>;
  setState: (next: RunState) => Promise<void>;
  outcome: (answer: string, completed: boolean) => AgentOutcome;
  turns: TurnTrace[];
}): Promise<AgentOutcome> {
  const prepared = await prepareRunLoop({
    ...opts.prepareInput,
    task: opts.task,
    prior: opts.prior,
    turns: opts.turns,
    createToolPipeline: opts.newToolPipeline,
    debugLogUrl: opts.debugLogUrl,
  });

  opts.onPrepared({
    turnState: prepared.turnState,
    pinnedTask: prepared.pinnedTask,
    requests: prepared.requests,
  });

  return executeTurnLoop({
    maxTurns: opts.maxTurns,
    turnState: prepared.turnState,
    turnCtx: prepared.turnCtx,
    buildTurnDeps: (turn, state, ctx) =>
      buildAgentTurnDeps({
        turn,
        signal: opts.signal,
        state,
        ctx,
        host: opts.turnHost(),
      }),
    onGlobalTurn: opts.onGlobalTurn,
    persist: opts.persist,
    setState: opts.setState,
    outcome: opts.outcome,
  });
}
