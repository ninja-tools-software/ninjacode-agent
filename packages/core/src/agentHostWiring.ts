import type { LlmProvider, Message, TokenUsage, ToolSpec } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider } from "@ninjacode/tools";
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
  trackTokenUsage,
} from "./agentRuntime.js";

export interface AgentHostBindings {
  provider: LlmProvider;
  maxTokens: number;
  maxTurns: number;
  model?: string;
  utilityModel?: string;
  enablePromptCache: boolean;
  reasoningEffort?: import("@ninjacode/providers").ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  pinnedTask?: string;
  enableLoopDetection: boolean;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  createAgent: AgentFactory;
  modifiedFiles: Set<string>;
  budget: BudgetTracker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  mode: AgentMode;
  skills: SkillDefinition[];
  onEvent?: AgentEventHandler;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
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
}

export function buildAgentTurnHost(host: AgentHostBindings): TurnHostInput {
  return {
    provider: host.provider,
    maxTokens: host.maxTokens,
    maxTurns: host.maxTurns,
    model: host.model,
    utilityModel: host.utilityModel,
    enablePromptCache: host.enablePromptCache,
    reasoningEffort: host.reasoningEffort,
    thinkingBudgetTokens: host.thinkingBudgetTokens,
    contextWindow: host.contextWindow,
    pinnedTask: host.pinnedTask,
    enableLoopDetection: host.enableLoopDetection,
    enableCompletionVerification: host.enableCompletionVerification,
    enableVerificationSubAgent: host.enableVerificationSubAgent,
    createAgent: host.createAgent,
    modifiedFiles: host.modifiedFiles,
    budget: host.budget,
    workspaceRoot: host.workspaceRoot,
    agentDir: host.agentDir,
    sessionId: host.sessionId,
    planId: host.planId,
    onEvent: host.onEvent,
    codebaseIndex: host.codebaseIndex,
    diagnosticsProvider: host.diagnosticsProvider,
    cacheStats: host.cacheStats,
    signal: host.signal,
    readScratchpad: () => readAgentScratchpad(host.agentDir),
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
      }),
    trackUsage: (usage: TokenUsage) => trackTokenUsage(host.budget, host.cacheStats, usage),
    checkRunTimeout: () => checkRunTimeout(host.runTimeoutMs, host.runStartedAt),
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
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
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
    tools: host.tools,
    history: host.history,
    pinnedTask: host.pinnedTask,
    pendingCheckpointId: host.pendingCheckpointId,
    globalTurn: host.globalTurn,
    toolCallFingerprints: host.toolCallFingerprints,
    readScratchpad: () => readAgentScratchpad(host.agentDir),
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
