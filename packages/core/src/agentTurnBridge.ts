import type { LlmProvider, Message, TokenUsage, ToolSpec } from "@ninjacode/providers";
import type {
  CodebaseIndexLike,
  DiagnosticsProvider,
  SandboxMode,
  ToolRegistry,
} from "@ninjacode/tools";
import type { BudgetTracker } from "./reliability.js";
import type { AgentTurnDeps } from "./agentTurn.js";
import type { ToolPipeline } from "./toolPipeline.js";
import type { VerifyConfig } from "./verify.js";
import type { AgentEventHandler, RunState } from "./types.js";
import type { AgentFactory } from "./agentFactory.js";
import {
  runAdaptiveOrchestrationSubAgent,
  runCompletionVerification,
  runVerificationSubAgent,
} from "./agentSupport.js";
import { sessionEventLog } from "./sessionEventLog.js";
import { SessionArtifactStore } from "./sessionArtifacts.js";
import type {
  OrchestrationProfile,
  ResolvedAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";
import type {
  ResolvedSubAgentGovernance,
  SubAgentOrchestrator,
} from "./subagentOrchestrator.js";
import type {
  ResolvedIndependentVerifierOptions,
  VerificationMode,
} from "./agentOptions.js";
import type { ResolvedLlmTurnStallOptions } from "./llmTurnGuard.js";

export interface TurnHostInput {
  provider: LlmProvider;
  maxTokens: number;
  maxTurns: number;
  model?: string;
  utilityModel?: string;
  enablePromptCache: boolean;
  minimalVolatileContext: boolean;
  reasoningEffort?: import("@ninjacode/providers").ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  pinnedTask?: string;
  enableLoopDetection: boolean;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  verificationMode: VerificationMode;
  independentVerifier: ResolvedIndependentVerifierOptions;
  enableSubagents: boolean;
  orchestrationProfile: OrchestrationProfile;
  adaptiveOrchestration: ResolvedAdaptiveOrchestrationOptions;
  llmTurnStall: ResolvedLlmTurnStallOptions;
  subagentGovernance: ResolvedSubAgentGovernance;
  subagentOrchestrator: SubAgentOrchestrator;
  createAgent: AgentFactory;
  modifiedFiles: Set<string>;
  budget: BudgetTracker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  sandboxMode: SandboxMode;
  persistSessionContext: boolean;
  onEvent?: AgentEventHandler;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  cacheStats: { cacheReadTokens: number; cacheWriteTokens: number };
  signal: AbortSignal;
  readScratchpad: () => Promise<string>;
  readActivePlan: () => Promise<string>;
  estimateUsage: (system: string, history: Message[], toolSpecs: ToolSpec[]) => import("./contextEstimate.js").ContextUsageBreakdown;
  trackUsage: (
    usage: TokenUsage,
    opts?: { category?: "compaction"; model?: string },
  ) => void;
  checkRunTimeout: () => string | undefined;
  remainingRunMs: () => number;
  runTimeoutMs: number;
  runHooks: AgentTurnDeps["runHooks"];
  persist: () => Promise<void>;
  setState: (next: RunState) => Promise<void>;
  emit: AgentTurnDeps["emit"];
  logAgentEvent: AgentTurnDeps["logAgentEvent"];
  isAbortError: (error: unknown) => boolean;
  outcome: (answer: string, completed: boolean) => import("./types.js").AgentOutcome;
}

function turnContextDeps(
  turn: number,
  signal: AbortSignal,
  state: AgentTurnDeps["state"],
  ctx: {
    toolSpecs: ToolSpec[];
    modeTools: ToolRegistry;
    verifyConfig: VerifyConfig;
    toolPipeline: ToolPipeline;
  },
): Pick<
  AgentTurnDeps,
  "turn" | "signal" | "state" | "toolSpecs" | "modeTools" | "verifyConfig" | "toolPipeline"
> {
  return {
    turn,
    signal,
    state,
    toolSpecs: ctx.toolSpecs,
    modeTools: ctx.modeTools,
    verifyConfig: ctx.verifyConfig,
    toolPipeline: ctx.toolPipeline,
  };
}

function turnHostDeps(host: TurnHostInput): Omit<AgentTurnDeps, keyof ReturnType<typeof turnContextDeps>> {
  return {
    workspaceRoot: host.workspaceRoot,
    provider: host.provider,
    maxTokens: host.maxTokens,
    maxTurns: host.maxTurns,
    model: host.model,
    utilityModel: host.utilityModel,
    enablePromptCache: host.enablePromptCache,
    minimalVolatileContext: host.minimalVolatileContext,
    reasoningEffort: host.reasoningEffort,
    thinkingBudgetTokens: host.thinkingBudgetTokens,
    contextWindow: host.contextWindow,
    pinnedTask: host.pinnedTask,
    enableLoopDetection: host.enableLoopDetection,
    enableCompletionVerification: host.enableCompletionVerification,
    enableVerificationSubAgent: host.enableVerificationSubAgent,
    verificationMode: host.verificationMode,
    independentVerifier: host.independentVerifier,
    enableSubagents: host.enableSubagents,
    orchestrationProfile: host.orchestrationProfile,
    adaptiveOrchestration: host.adaptiveOrchestration,
    llmTurnStall: host.llmTurnStall,
    modifiedFiles: host.modifiedFiles,
    activeFilesProvider: host.activeFilesProvider,
    budget: host.budget,
    readScratchpad: host.readScratchpad,
    readActivePlan: host.readActivePlan,
    estimateUsage: host.estimateUsage,
    trackUsage: host.trackUsage,
    getCacheStats: () => ({ ...host.cacheStats, ...host.budget.snapshot() }),
    checkRunTimeout: host.checkRunTimeout,
    remainingRunMs: host.remainingRunMs,
    runTimeoutMs: host.runTimeoutMs,
    runHooks: host.runHooks,
    runCompletionVerification: (config) =>
      runCompletionVerification({
        workspaceRoot: host.workspaceRoot,
        agentDir: host.agentDir,
        sessionId: host.sessionId,
        planId: host.planId,
        sandboxMode: host.sandboxMode,
        signal: host.signal,
        codebaseIndex: host.codebaseIndex,
        diagnosticsProvider: host.diagnosticsProvider,
        modifiedFiles: host.modifiedFiles,
        config,
      }),
    runVerificationSubAgent: (verification) =>
      runVerificationSubAgent({
        provider: host.provider,
        workspaceRoot: host.workspaceRoot,
        agentDir: host.agentDir,
        onEvent: host.onEvent,
        signal: host.signal,
        modifiedFiles: host.modifiedFiles,
        verification,
        mode: host.verificationMode,
        verifier: host.independentVerifier,
        utilityModel: host.utilityModel,
        budget: host.budget,
        createAgent: host.createAgent,
        orchestrator: host.subagentOrchestrator,
      }),
    runAdaptiveSubAgent: (role, reason) =>
      runAdaptiveOrchestrationSubAgent({
        provider: host.provider,
        workspaceRoot: host.workspaceRoot,
        agentDir: host.agentDir,
        onEvent: host.onEvent,
        signal: host.signal,
        task: host.pinnedTask ?? "",
        reason,
        role,
        parentModel: host.model,
        utilityModel: host.utilityModel,
        createAgent: host.createAgent,
        orchestrator: host.subagentOrchestrator,
      }),
    recordSessionEvent: async (type, payload) => {
      if (!host.persistSessionContext) return;
      await sessionEventLog(host.agentDir, host.sessionId).append(type, payload);
    },
    archiveCompaction: async (messages, info) => {
      if (!host.persistSessionContext) return;
      const artifact = await new SessionArtifactStore(host.agentDir, host.sessionId).putText(
        JSON.stringify(messages),
        { kind: "compaction_segment", mimeType: "application/json" },
      );
      await sessionEventLog(host.agentDir, host.sessionId).append("compaction", {
        ...info,
        artifactId: artifact.id,
      });
    },
    persist: host.persist,
    setState: host.setState,
    emit: host.emit,
    logAgentEvent: host.logAgentEvent,
    isAbortError: host.isAbortError,
    outcome: host.outcome,
  };
}

export function buildAgentTurnDeps(opts: {
  turn: number;
  signal: AbortSignal;
  state: AgentTurnDeps["state"];
  ctx: {
    toolSpecs: ToolSpec[];
    modeTools: ToolRegistry;
    verifyConfig: VerifyConfig;
    toolPipeline: ToolPipeline;
  };
  host: TurnHostInput;
}): AgentTurnDeps {
  return {
    ...turnContextDeps(opts.turn, opts.signal, opts.state, opts.ctx),
    ...turnHostDeps(opts.host),
  };
}
