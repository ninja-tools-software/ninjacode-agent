import type { AgentHostBindings } from "./agentHostWiring.js";
import type { Message } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider, ToolRegistry } from "@ninjacode/tools";
import { resolveAgentConfig, type AgentOptions } from "./agentOptions.js";
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
  runTimeoutMs: number;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  enableLoopDetection: boolean;
  sessionId: string;
  onEvent?: AgentEventHandler;
  onApproval?: ApprovalHandler;
  enableCheckpoints: boolean;
  enablePromptCache: boolean;
  persistSessions: boolean;
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
    runTimeoutMs: cfg.runTimeoutMs,
    enableCompletionVerification: cfg.enableCompletionVerification,
    enableVerificationSubAgent: cfg.enableVerificationSubAgent,
    enableLoopDetection: cfg.enableLoopDetection,
    sessionId: cfg.sessionId,
    onEvent: opts.onEvent,
    onApproval: opts.onApproval,
    enableCheckpoints: cfg.enableCheckpoints,
    enablePromptCache: cfg.enablePromptCache,
    persistSessions: cfg.persistSessions,
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
  },
): AgentHostBindings {
  return {
    provider: config.provider,
    maxTokens: config.maxTokens,
    maxTurns: config.maxTurns,
    model: config.model,
    utilityModel: config.utilityModel,
    enablePromptCache: config.enablePromptCache,
    reasoningEffort: config.reasoningEffort,
    thinkingBudgetTokens: config.thinkingBudgetTokens,
    contextWindow: config.contextWindow,
    pinnedTask: runtime.pinnedTask,
    enableLoopDetection: config.enableLoopDetection,
    enableCompletionVerification: config.enableCompletionVerification,
    enableVerificationSubAgent: config.enableVerificationSubAgent,
    createAgent,
    modifiedFiles: runtime.modifiedFiles,
    budget: config.budget,
    workspaceRoot: config.workspaceRoot,
    agentDir: config.agentDir,
    sessionId: config.sessionId,
    planId: runtime.planId,
    mode: config.mode,
    skills: runtime.skills,
    onEvent: config.onEvent,
    codebaseIndex: config.codebaseIndex,
    diagnosticsProvider: config.diagnosticsProvider,
    cacheStats: runtime.cacheStats,
    runTimeoutMs: config.runTimeoutMs,
    runStartedAt: runtime.runStartedAt,
    signal: runtime.controller.signal,
    ...callbacks,
  };
}
