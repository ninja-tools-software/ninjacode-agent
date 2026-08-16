import type { AgentHostBindings } from "./agentHostWiring.js";
import type { Message } from "@ninjacode/providers";
import type {
  CodebaseIndexLike,
  DiagnosticsProvider,
  SandboxMode,
  ToolRegistry,
} from "@ninjacode/tools";
import {
  resolveAgentConfig,
  type AgentOptions,
  type ResolvedIndependentVerifierOptions,
  type VerificationMode,
} from "./agentOptions.js";
import { ToolCircuitBreaker } from "./reliability.js";
import { DebugLogServer, DebugSession } from "./debug.js";
import { HookRunner } from "./hooks.js";
import type { SkillDefinition } from "./skills.js";
import type {
  AgentEventHandler,
  AgentMode,
  ApprovalHandler,
  RequestCheckpoint,
  RunState,
  TurnTrace,
} from "./types.js";
import type { TrajectoryCaptureOptions } from "./trajectory.js";
import type { SubAgentOrchestrator } from "./subagentOrchestrator.js";
import type {
  OrchestrationProfile,
  ResolvedAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";

export interface AgentConfig {
  provider: AgentOptions["provider"] & { name: string };
  tools: ToolRegistry;
  permissions: AgentOptions["permissions"];
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  maxTurns: number;
  maxTokens: number;
  model?: string;
  utilityModel?: string;
  reasoningEffort: AgentOptions["reasoningEffort"];
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  sandboxMode: SandboxMode;
  runTimeoutMs: number;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  verificationMode: VerificationMode;
  independentVerifier: ResolvedIndependentVerifierOptions;
  enableLoopDetection: boolean;
  enableSubagents: boolean;
  orchestrationProfile: OrchestrationProfile;
  adaptiveOrchestration: ResolvedAdaptiveOrchestrationOptions;
  subagentOrchestrator: SubAgentOrchestrator;
  trajectory?: TrajectoryCaptureOptions;
  sessionId: string;
  onEvent?: AgentEventHandler;
  onApproval?: ApprovalHandler;
  enableCheckpoints: boolean;
  enablePromptCache: boolean;
  persistSessions: boolean;
  performance: ReturnType<typeof resolveAgentConfig>["performance"];
  enableWorkspaceHooks: boolean;
  checkpoints: ReturnType<typeof resolveAgentConfig>["checkpoints"];
  budget: ReturnType<typeof resolveAgentConfig>["budget"];
  createdAt: string;
  externalSignal?: AbortSignal;
  breaker: ToolCircuitBreaker;
}

export interface AgentRuntime {
  history: Message[];
  turns: TurnTrace[];
  pinnedTask?: string;
  planId: string;
  controller: AbortController;
  state: RunState;
  cacheStats: { cacheReadTokens: number; cacheWriteTokens: number };
  debugServer: DebugLogServer | null;
  debugSession: DebugSession | null;
  hookRunner: HookRunner | null;
  skills: SkillDefinition[];
  requestSeq: number;
  globalTurn: number;
  modifiedFiles: Set<string>;
  toolCallFingerprints: string[];
  runStartedAt: number;
  requests: RequestCheckpoint[];
  pendingCheckpointId?: string;
}

export function createAgentConfig(
  opts: AgentOptions,
  cfg: ReturnType<typeof resolveAgentConfig>,
  subagentOrchestrator: SubAgentOrchestrator,
): AgentConfig {
  return {
    provider: cfg.provider,
    tools: opts.tools,
    permissions: opts.permissions,
    workspaceRoot: cfg.workspaceRoot,
    agentDir: cfg.agentDir,
    mode: cfg.mode,
    maxTurns: cfg.maxTurns,
    maxTokens: cfg.maxTokens,
    model: cfg.model,
    utilityModel: cfg.utilityModel,
    reasoningEffort: cfg.reasoningEffort,
    thinkingBudgetTokens: cfg.thinkingBudgetTokens,
    contextWindow: cfg.contextWindow,
    codebaseIndex: cfg.codebaseIndex,
    diagnosticsProvider: cfg.diagnosticsProvider,
    activeFilesProvider: cfg.activeFilesProvider,
    sandboxMode: cfg.sandboxMode,
    runTimeoutMs: cfg.runTimeoutMs,
    enableCompletionVerification: cfg.enableCompletionVerification,
    enableVerificationSubAgent: cfg.enableVerificationSubAgent,
    verificationMode: cfg.verificationMode,
    independentVerifier: cfg.independentVerifier,
    enableLoopDetection: cfg.enableLoopDetection,
    enableSubagents: cfg.enableSubagents,
    orchestrationProfile: cfg.orchestrationProfile,
    adaptiveOrchestration: cfg.adaptiveOrchestration,
    subagentOrchestrator,
    trajectory: opts.trajectory,
    sessionId: cfg.sessionId,
    onEvent: opts.onEvent,
    onApproval: opts.onApproval,
    enableCheckpoints: cfg.enableCheckpoints,
    enablePromptCache: cfg.enablePromptCache,
    persistSessions: cfg.persistSessions,
    performance: cfg.performance,
    enableWorkspaceHooks: opts.enableWorkspaceHooks !== false,
    budget: cfg.budget,
    checkpoints: cfg.checkpoints,
    createdAt: cfg.createdAt,
    externalSignal: opts.signal,
    breaker: new ToolCircuitBreaker(3),
  };
}

export function createAgentRuntime(planId: string): AgentRuntime {
  return {
    history: [],
    turns: [],
    planId,
    controller: new AbortController(),
    state: "idle",
    cacheStats: { cacheReadTokens: 0, cacheWriteTokens: 0 },
    debugServer: null,
    debugSession: null,
    hookRunner: null,
    skills: [],
    requestSeq: 0,
    globalTurn: 0,
    modifiedFiles: new Set(),
    toolCallFingerprints: [],
    runStartedAt: 0,
    requests: [],
  };
}

export function buildHostBindingSource(
  config: AgentConfig,
  runtime: AgentRuntime,
  createAgent: import("./agentFactory.js").AgentFactory,
  callbacks: {
    runHooks: import("./agentTurnBridge.js").TurnHostInput["runHooks"];
    persist: () => Promise<void>;
    setState: (next: RunState) => Promise<void>;
    emit: import("./agentTurnBridge.js").TurnHostInput["emit"];
    logAgentEvent: import("./agentTurnBridge.js").TurnHostInput["logAgentEvent"];
    outcome: (answer: string, completed: boolean) => import("./types.js").AgentOutcome;
    abortRun?: (reason: unknown) => void;
  },
): AgentHostBindings {
  return {
    provider: config.provider,
    maxTokens: config.maxTokens,
    maxTurns: config.maxTurns,
    model: config.model,
    utilityModel: config.utilityModel,
    enablePromptCache: config.enablePromptCache,
    minimalVolatileContext: config.performance.minimalVolatileContext,
    reasoningEffort: config.reasoningEffort,
    thinkingBudgetTokens: config.thinkingBudgetTokens,
    contextWindow: config.contextWindow,
    pinnedTask: runtime.pinnedTask,
    enableLoopDetection: config.enableLoopDetection,
    enableCompletionVerification: config.enableCompletionVerification,
    enableVerificationSubAgent: config.enableVerificationSubAgent,
    verificationMode: config.verificationMode,
    independentVerifier: config.independentVerifier,
    enableSubagents: config.enableSubagents,
    orchestrationProfile: config.orchestrationProfile,
    adaptiveOrchestration: config.adaptiveOrchestration,
    subagentGovernance: config.subagentOrchestrator.governance,
    subagentOrchestrator: config.subagentOrchestrator,
    createAgent,
    modifiedFiles: runtime.modifiedFiles,
    budget: config.budget,
    workspaceRoot: config.workspaceRoot,
    agentDir: config.agentDir,
    sessionId: config.sessionId,
    planId: runtime.planId,
    sandboxMode: config.sandboxMode,
    persistSessionContext: config.persistSessions,
    mode: config.mode,
    skills: runtime.skills,
    onEvent: config.onEvent,
    codebaseIndex: config.codebaseIndex,
    diagnosticsProvider: config.diagnosticsProvider,
    activeFilesProvider: config.activeFilesProvider,
    cacheStats: runtime.cacheStats,
    runTimeoutMs: config.runTimeoutMs,
    runStartedAt: runtime.runStartedAt,
    signal: runtime.controller.signal,
    ...callbacks,
  };
}
