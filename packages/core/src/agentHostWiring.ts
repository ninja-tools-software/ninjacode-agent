import type { LlmProvider, Message, TokenUsage, ToolSpec } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider, SandboxMode } from "@ninjacode/tools";
import type { TurnHostInput } from "./agentTurnBridge.js";
import { createAgentToolPipeline } from "./agentSupport.js";
import type { PermissionEngine } from "./permissions.js";
import type { ToolCircuitBreaker, BudgetTracker } from "./reliability.js";
import type { HookRunResult } from "./hooks.js";
import type { RunLoopPrepareInput } from "./agentRunLoop.js";
import type { AgentFactory } from "./agentFactory.js";
import type {
  AgentEventHandler,
  AgentMode,
  AgentOutcome,
  ApprovalHandler,
  RunState,
} from "./types.js";
import type { ToolPipeline } from "./toolPipeline.js";
import type { SkillDefinition } from "./skills.js";
import {
  buildAgentSystemPrompt,
  readAgentActivePlan,
  readAgentScratchpad,
} from "./agentPlanContext.js";
import {
  checkRunTimeout,
  estimateAgentUsage,
  isAbortError,
  remainingRunMs,
  trackTokenUsage,
} from "./agentRuntime.js";
import type { ResolvedLlmTurnStallOptions } from "./llmTurnGuard.js";
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

export interface AgentHostBindings {
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
  mode: AgentMode;
  skills: SkillDefinition[];
  onEvent?: AgentEventHandler;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  cacheStats: { cacheReadTokens: number; cacheWriteTokens: number };
  runTimeoutMs: number;
  runStartedAt: number;
  signal: AbortSignal;
  runHooks: TurnHostInput["runHooks"];
  persist: () => Promise<void>;
  setState: (next: RunState) => Promise<void>;
  emit: TurnHostInput["emit"];
  logAgentEvent: TurnHostInput["logAgentEvent"];
  outcome: (answer: string, completed: boolean) => AgentOutcome;
  abortRun?: (reason: unknown) => void;
}

export function buildAgentTurnHost(host: AgentHostBindings): TurnHostInput {
  return {
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
    subagentGovernance: host.subagentGovernance,
    subagentOrchestrator: host.subagentOrchestrator,
    createAgent: host.createAgent,
    modifiedFiles: host.modifiedFiles,
    budget: host.budget,
    workspaceRoot: host.workspaceRoot,
    agentDir: host.agentDir,
    sessionId: host.sessionId,
    planId: host.planId,
    sandboxMode: host.sandboxMode,
    persistSessionContext: host.persistSessionContext,
    onEvent: host.onEvent,
    codebaseIndex: host.codebaseIndex,
    diagnosticsProvider: host.diagnosticsProvider,
    activeFilesProvider: host.activeFilesProvider,
    cacheStats: host.cacheStats,
    signal: host.signal,
    readScratchpad: () => readAgentScratchpad(host.agentDir, host.sessionId),
    readActivePlan: () => readAgentActivePlan(host.agentDir, host.planId),
    estimateUsage: (system: string, history: Message[], toolSpecs: ToolSpec[]) =>
      estimateAgentUsage({
        system,
        history,
        toolSpecs,
        contextWindow: host.contextWindow,
        maxTokens: host.maxTokens,
        cacheReadTokens: host.cacheStats.cacheReadTokens,
        cacheWriteTokens: host.cacheStats.cacheWriteTokens,
        model: host.model,
      }),
    trackUsage: (
      usage: TokenUsage,
      opts?: { category?: "compaction"; model?: string; durationMs?: number },
    ) => trackTokenUsage(host.budget, host.cacheStats, usage, opts),
    checkRunTimeout: () => {
      const reason = checkRunTimeout(host.runTimeoutMs, host.runStartedAt);
      if (reason) host.abortRun?.(new DOMException(reason, "TimeoutError"));
      return reason;
    },
    remainingRunMs: () => remainingRunMs(host.runTimeoutMs, host.runStartedAt),
    runHooks: host.runHooks,
    persist: host.persist,
    setState: host.setState,
    emit: host.emit,
    logAgentEvent: host.logAgentEvent,
    isAbortError: (error) => isAbortError(host.signal, error),
    outcome: host.outcome,
  };
}

export function createRunToolPipeline(opts: {
  signal: AbortSignal;
  permissions: PermissionEngine;
  breaker: ToolCircuitBreaker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  sandboxMode: SandboxMode;
  persistSessionContext: boolean;
  parallelToolReads: boolean;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  onApproval?: ApprovalHandler;
  getState: () => RunState;
  setState: (next: RunState) => Promise<void>;
  runHooks: (
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ) => Promise<HookRunResult[]>;
  emit: AgentEventHandler | undefined;
  logAgentEvent: (type: "tool_call" | "tool_result" | "cancel", summary: string, detail?: string) => void;
  waitOrAbort: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  modifiedFiles: Set<string>;
}): ToolPipeline {
  return createAgentToolPipeline({
    ...opts,
    emit: async (type, payload) => {
      await opts.emit?.({ type, payload } as Parameters<NonNullable<AgentEventHandler>>[0]);
    },
  });
}

export function buildRunLoopPrepareInput(host: AgentHostBindings & {
  providerName: string;
  tools: import("@ninjacode/tools").ToolRegistry;
  history: Message[];
  pendingCheckpointId?: string;
  globalTurn: number;
  toolCallFingerprints: string[];
  setupHooks: () => Promise<void>;
  setupSkills: () => Promise<void>;
}): RunLoopPrepareInput {
  return {
    workspaceRoot: host.workspaceRoot,
    agentDir: host.agentDir,
    mode: host.mode,
    providerName: host.providerName,
    model: host.model,
    maxTurns: host.maxTurns,
    enableSubagents: host.enableSubagents,
    orchestrationProfile: host.orchestrationProfile,
    adaptiveOrchestration: host.adaptiveOrchestration,
    tools: host.tools,
    history: host.history,
    pinnedTask: host.pinnedTask,
    pendingCheckpointId: host.pendingCheckpointId,
    globalTurn: host.globalTurn,
    toolCallFingerprints: host.toolCallFingerprints,
    readScratchpad: () => readAgentScratchpad(host.agentDir, host.sessionId),
    readActivePlan: () => readAgentActivePlan(host.agentDir, host.planId),
    buildSystem: (opts) =>
      buildAgentSystemPrompt({
        mode: host.mode,
        workspaceRoot: host.workspaceRoot,
        agentDir: host.agentDir,
        skills: host.skills,
        ...opts,
      }),
    setupHooks: host.setupHooks,
    setupSkills: host.setupSkills,
  };
}
