import { findModelAnywhere } from "@ninjacode/providers";
import type { Message, ToolSpec } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import { discoverRules } from "./rules.js";
import { loadVerifyConfig, type VerifyConfig } from "./verify.js";
import { filterToolsForEditFormat } from "./editTools.js";
import { resolveHarnessProfile } from "./harnessProfiles.js";
import {
  buildUserMessageContent,
  dropOrphanUserMessage,
  runAgentTurn,
  type AgentTurnDeps,
  type AgentTurnMutableState,
} from "./agentTurn.js";
import type { ToolPipeline } from "./toolPipeline.js";
import type { AgentTaskInput } from "./agentOptions.js";
import { buildVolatileContextMessage } from "./volatileContext.js";
import type { AgentMode, AgentOutcome, RequestCheckpoint, RunState } from "./types.js";
import {
  createPhasePolicyState,
  type OrchestrationProfile,
  type ResolvedAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";

interface RunLoopContext {
  toolSpecs: ToolSpec[];
  modeTools: ToolRegistry;
  verifyConfig: VerifyConfig;
  toolPipeline: ToolPipeline;
}

export type RunLoopPrepareInput = Omit<
  RunLoopSetupInput,
  "task" | "prior" | "turns" | "createToolPipeline" | "debugLogUrl"
>;

export interface RunLoopSetupInput {
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  maxTurns: number;
  enableSubagents: boolean;
  orchestrationProfile: OrchestrationProfile;
  adaptiveOrchestration: ResolvedAdaptiveOrchestrationOptions;
  providerName: string;
  model?: string;
  tools: ToolRegistry;
  task: AgentTaskInput;
  prior: Message[];
  history: Message[];
  pinnedTask?: string;
  pendingCheckpointId?: string;
  globalTurn: number;
  toolCallFingerprints: string[];
  turns: AgentTurnMutableState["turns"];
  readScratchpad: () => Promise<string>;
  readActivePlan: () => Promise<string>;
  buildSystem: (opts: { rules: string; debugLogUrl?: string }) => Promise<string>;
  setupHooks: () => Promise<void>;
  setupSkills: () => Promise<void>;
  createToolPipeline: () => ToolPipeline;
  debugLogUrl?: string;
}

interface RunLoopSetupResult {
  turnState: AgentTurnMutableState;
  turnCtx: RunLoopContext;
  pinnedTask: string;
  requests: RequestCheckpoint[];
}

export async function prepareRunLoop(input: RunLoopSetupInput): Promise<RunLoopSetupResult> {
  const { text: rules } = await discoverRules(input.workspaceRoot);
  const volatileContext = {
    scratchpad: await input.readScratchpad(),
    plan: await input.readActivePlan(),
  };

  await input.setupHooks();
  await input.setupSkills();

  const system = await input.buildSystem({ rules, debugLogUrl: input.debugLogUrl });

  const verifyConfig = await loadVerifyConfig(input.agentDir);
  let history = input.history;
  if (input.prior.length > 0 && history.length === 0) {
    history = [...input.prior];
  }

  const pinnedTask = input.pinnedTask ?? input.task.text;
  const modelInfo = input.model ? findModelAnywhere(input.model) : undefined;
  const supportsVision = modelInfo?.vision ?? false;
  const { content, parts } = buildUserMessageContent(input.task.text, input.task.images ?? [], supportsVision);

  dropOrphanUserMessage(history, content);
  // Volatile state goes before the task so the task stays the last thing read.
  const volatileMessage = buildVolatileContextMessage(volatileContext);
  if (volatileMessage) history.push(volatileMessage);
  history.push({ role: "user", content, parts });

  const requests: RequestCheckpoint[] = [];
  if (input.pendingCheckpointId) {
    requests.push({
      checkpointId: input.pendingCheckpointId,
      userMessageIndex: history.length - 1,
    });
  }

  const profile = resolveHarnessProfile({
    providerKind: input.providerName,
    modelId: input.model,
  });
  const modeTools = filterToolsForEditFormat(input.tools.forMode(input.mode), profile.editFormat);
  const toolSpecs = modeTools.specs();
  const toolPipeline = input.createToolPipeline();

  const turnState: AgentTurnMutableState = {
    history,
    turns: input.turns,
    system,
    volatileContext,
    emptyResponseRetries: 0,
    stopHookRetries: 0,
    verificationRetries: 0,
    llmStallRetries: 0,
    recentLlmTurnMs: [],
    firedClockMarks: [],
    globalTurn: input.globalTurn,
    toolCallFingerprints: input.toolCallFingerprints,
    phasePolicy:
      input.orchestrationProfile === "adaptive" &&
      (input.mode === "agent" || input.mode === "debug" || input.mode === "plan")
        ? createPhasePolicyState({
            task: pinnedTask,
            maxTurns: input.maxTurns,
            goal: input.mode === "plan" ? "plan" : "edit",
            options: {
              ...input.adaptiveOrchestration,
              automaticDelegation:
                input.enableSubagents && input.adaptiveOrchestration.automaticDelegation,
            },
          })
        : undefined,
  };

  return {
    turnState,
    turnCtx: { toolSpecs, modeTools, verifyConfig, toolPipeline },
    pinnedTask,
    requests,
  };
}

export async function executeTurnLoop(opts: {
  maxTurns: number;
  turnState: AgentTurnMutableState;
  turnCtx: RunLoopContext;
  buildTurnDeps: (turn: number, state: AgentTurnMutableState, ctx: RunLoopContext) => AgentTurnDeps;
  onGlobalTurn: (turn: number) => void;
  persist: () => Promise<void>;
  setState: (next: RunState) => Promise<void>;
  outcome: (answer: string, completed: boolean) => AgentOutcome;
}): Promise<AgentOutcome> {
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const result = await runAgentTurn(opts.buildTurnDeps(turn, opts.turnState, opts.turnCtx));
    opts.onGlobalTurn(opts.turnState.globalTurn);

    if (result.kind === "continue") continue;
    if (result.kind === "done") return opts.outcome(result.answer, true);
    if (result.kind === "stopped") return opts.outcome(result.message, false);
    return opts.outcome(result.message, false);
  }

  await opts.persist();
  await opts.setState("failed");
  return opts.outcome("Max turns reached without completing the task.", false);
}
