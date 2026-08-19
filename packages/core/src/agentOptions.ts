import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveModelPricing, type LlmProvider, type ReasoningEffort } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider, SandboxMode } from "@ninjacode/tools";
import { planIdForSession } from "@ninjacode/tools";
import { BudgetTracker, withRetry, type SessionBudget } from "./reliability.js";
import { CheckpointManager } from "./checkpoints.js";
import { resolveHarnessProfile } from "./harnessProfiles.js";
import type { AgentMode, AgentEventHandler, ApprovalHandler } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import type { ToolRegistry } from "@ninjacode/tools";
import type { ContentPart } from "@ninjacode/providers";
import { clampMaxTokens } from "./contextEstimate.js";
import type { TrajectoryCaptureOptions } from "./trajectory.js";
import {
  resolveAdaptiveOrchestrationOptions,
  type AdaptiveOrchestrationOptions,
  type OrchestrationProfile,
  type ResolvedAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";
import type { VerificationMode } from "./verificationTypes.js";
import {
  resolveLlmTurnStallOptions,
  type LlmTurnStallOptions,
  type ResolvedLlmTurnStallOptions,
} from "./llmTurnGuard.js";
export type { VerificationMode } from "./verificationTypes.js";

/** Input to `Agent.run` — a plain string, or text plus multimodal image parts. */
export interface AgentTaskInput {
  text: string;
  images?: ContentPart[];
}

/** Limits applied independently to every delegated child agent. */
export interface SubAgentGovernanceOptions {
  /** Maximum number of children running at once for one orchestrator. */
  maxConcurrency?: number;
  /** Estimated list-price ceiling for each child. */
  maxCostUsd?: number;
  /** Turn ceiling for each child. */
  maxTurns?: number;
  /** Wall-clock ceiling for each child. */
  timeoutMs?: number;
}

export interface IndependentVerifierOptions {
  /** Hard fraction of the parent run cost ceiling. Clamped to at most 10%. */
  maxRunCostRatio?: number;
  /** Additional absolute ceiling, still bounded by maxRunCostRatio. */
  maxCostUsd?: number;
  /** Small turn ceiling for the economy verifier. */
  maxTurns?: number;
  /** Independent wall-clock ceiling. */
  timeoutMs?: number;
  /** Maximum diff characters included in verifier evidence. */
  maxDiffChars?: number;
}

export interface ResolvedIndependentVerifierOptions {
  maxRunCostRatio: number;
  maxCostUsd: number;
  maxTurns: number;
  timeoutMs: number;
  maxDiffChars: number;
}

/** Independently switchable cost/latency optimizations for controlled ablations. */
export interface PerformanceOptions {
  parallelToolReads?: boolean;
  asyncSessionPersistence?: boolean;
  minimalVolatileContext?: boolean;
  persistenceDebounceMs?: number;
}

export interface ResolvedPerformanceOptions {
  parallelToolReads: boolean;
  asyncSessionPersistence: boolean;
  minimalVolatileContext: boolean;
  persistenceDebounceMs: number;
}

export interface AgentOptions {
  provider: LlmProvider;
  tools: ToolRegistry;
  permissions: PermissionEngine;
  workspaceRoot: string;
  agentDir?: string;
  mode?: AgentMode;
  maxTurns?: number;
  maxTokens?: number;
  model?: string;
  /**
   * Cheap model for economy-tier sub-agents. Compaction always uses `model`.
   */
  utilityModel?: string;
  sessionId?: string;
  planId?: string;
  onEvent?: AgentEventHandler;
  onApproval?: ApprovalHandler;
  enableCheckpoints?: boolean;
  enablePromptCache?: boolean;
  enableSubagents?: boolean;
  subagentGovernance?: SubAgentGovernanceOptions;
  persistSessions?: boolean;
  budget?: SessionBudget;
  enableRetry?: boolean;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  /** Live host context (IDE tabs/selection, SCM files, or equivalent). */
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  /** OS boundary for shell, hooks, verification, and local MCP servers. */
  sandboxMode?: SandboxMode;
  runTimeoutMs?: number;
  /** Per-request ceilings so one unresponsive provider cannot eat the whole run. */
  llmTurnStall?: LlmTurnStallOptions;
  enableCompletionVerification?: boolean;
  /**
   * Compatibility switch for the LLM verifier. Prefer verificationMode for
   * A/B runs; an explicit false still disables every LLM verifier mode.
   */
  enableVerificationSubAgent?: boolean;
  /** A/B modes: current profile behavior, always-blind, or adaptive-blind. */
  verificationMode?: VerificationMode;
  independentVerifier?: IndependentVerifierOptions;
  enableLoopDetection?: boolean;
  /** A/B switch. Legacy preserves the previous late-nudge behavior exactly. */
  orchestrationProfile?: OrchestrationProfile;
  adaptiveOrchestration?: AdaptiveOrchestrationOptions;
  /** Cost/latency components. Defaults are conservative and independently ablatable. */
  performance?: PerformanceOptions;
  /**
   * Privacy-preserving structural trajectory capture. Disabled by default;
   * persistence additionally requires an explicit persistPath.
   */
  trajectory?: TrajectoryCaptureOptions;
  /** When false, workspace hooks.json is not loaded (untrusted workspaces). Default true. */
  enableWorkspaceHooks?: boolean;
  signal?: AbortSignal;
}

export interface ResolvedAgentConfig {
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  maxTurns: number;
  maxTokens: number;
  model?: string;
  utilityModel?: string;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  sandboxMode: SandboxMode;
  runTimeoutMs: number;
  llmTurnStall: ResolvedLlmTurnStallOptions;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  verificationMode: VerificationMode;
  independentVerifier: ResolvedIndependentVerifierOptions;
  enableLoopDetection: boolean;
  enableSubagents: boolean;
  orchestrationProfile: OrchestrationProfile;
  adaptiveOrchestration: ResolvedAdaptiveOrchestrationOptions;
  subagentGovernance?: SubAgentGovernanceOptions;
  sessionId: string;
  planId: string;
  enableCheckpoints: boolean;
  enablePromptCache: boolean;
  persistSessions: boolean;
  performance: ResolvedPerformanceOptions;
  budget: BudgetTracker;
  checkpoints: CheckpointManager;
  createdAt: string;
}

/**
 * A runaway loop is a billing incident, so every session carries a cost ceiling
 * even when the caller sets none. Pass `maxCostUsd: undefined` explicitly to opt
 * out. The figure is a list-price estimate, not an invoice.
 */
const DEFAULT_MAX_COST_USD = 5;
/** Product runs must not last forever; hosts may override. */
export const DEFAULT_RUN_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_VERIFIER_RUN_COST_RATIO = 0.1;
const DEFAULT_PERSISTENCE_DEBOUNCE_MS = 75;

function resolveBudget(budget: SessionBudget | undefined): SessionBudget {
  return { maxCostUsd: DEFAULT_MAX_COST_USD, ...budget };
}

function resolveProvider(opts: AgentOptions): LlmProvider {
  return opts.enableRetry === false ? opts.provider : withRetry(opts.provider);
}

function resolveMode(opts: AgentOptions): AgentMode {
  return opts.mode ?? "agent";
}

export function resolvePerformanceOptions(
  options: PerformanceOptions = {},
): ResolvedPerformanceOptions {
  return {
    parallelToolReads: options.parallelToolReads ?? true,
    asyncSessionPersistence: options.asyncSessionPersistence ?? true,
    minimalVolatileContext: options.minimalVolatileContext ?? true,
    persistenceDebounceMs: Math.floor(
      finiteBounded(
        options.persistenceDebounceMs,
        DEFAULT_PERSISTENCE_DEBOUNCE_MS,
        0,
        2_000,
      ),
    ),
  };
}

function resolveCompletionVerification(opts: AgentOptions, mode: AgentMode): boolean {
  return opts.enableCompletionVerification ?? (mode === "agent" || mode === "debug");
}

function finiteBounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function resolveIndependentVerifierOptions(
  options: IndependentVerifierOptions = {},
  parentMaxCostUsd = DEFAULT_MAX_COST_USD,
): ResolvedIndependentVerifierOptions {
  const maxRunCostRatio = finiteBounded(
    options.maxRunCostRatio,
    MAX_VERIFIER_RUN_COST_RATIO,
    0.001,
    MAX_VERIFIER_RUN_COST_RATIO,
  );
  const ratioCeiling = Math.max(0, parentMaxCostUsd) * maxRunCostRatio;
  const requestedCost =
    options.maxCostUsd !== undefined && Number.isFinite(options.maxCostUsd) && options.maxCostUsd > 0
      ? options.maxCostUsd
      : ratioCeiling;
  return {
    maxRunCostRatio,
    maxCostUsd: Math.min(requestedCost, ratioCeiling),
    maxTurns: Math.floor(finiteBounded(options.maxTurns, 4, 1, 8)),
    timeoutMs: Math.floor(finiteBounded(options.timeoutMs, 30_000, 1_000, 60_000)),
    maxDiffChars: Math.floor(finiteBounded(options.maxDiffChars, 12_000, 2_000, 24_000)),
  };
}

export function resolveAgentConfig(opts: AgentOptions): ResolvedAgentConfig {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const agentDir = opts.agentDir ?? path.join(workspaceRoot, ".ninjacode");
  const mode = resolveMode(opts);
  const sessionId = opts.sessionId ?? randomUUID();
  const profile = resolveHarnessProfile({
    providerKind: opts.provider.name,
    modelId: opts.model,
  });
  const sessionBudget = resolveBudget(opts.budget);
  const verificationMode = opts.verificationMode ?? profile.verificationMode;

  return {
    provider: resolveProvider(opts),
    workspaceRoot,
    agentDir,
    mode,
    maxTurns: opts.maxTurns ?? 64,
    maxTokens: clampMaxTokens(opts.maxTokens ?? 8192, opts.contextWindow),
    model: opts.model,
    utilityModel: opts.utilityModel,
    reasoningEffort: opts.reasoningEffort ?? profile.reasoningEffort,
    thinkingBudgetTokens: opts.thinkingBudgetTokens,
    contextWindow: opts.contextWindow,
    codebaseIndex: opts.codebaseIndex,
    diagnosticsProvider: opts.diagnosticsProvider,
    activeFilesProvider: opts.activeFilesProvider,
    sandboxMode: opts.sandboxMode ?? "workspace-write",
    runTimeoutMs: opts.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    llmTurnStall: resolveLlmTurnStallOptions(opts.llmTurnStall),
    enableCompletionVerification: resolveCompletionVerification(opts, mode),
    enableVerificationSubAgent:
      opts.enableVerificationSubAgent ??
      ((verificationMode !== "current" || profile.verification === "strict") &&
        (mode === "agent" || mode === "debug")),
    verificationMode,
    independentVerifier: resolveIndependentVerifierOptions(
      opts.independentVerifier,
      sessionBudget.maxCostUsd ?? DEFAULT_MAX_COST_USD,
    ),
    enableLoopDetection: opts.enableLoopDetection ?? true,
    enableSubagents: opts.enableSubagents !== false,
    orchestrationProfile: opts.orchestrationProfile ?? profile.orchestration,
    adaptiveOrchestration: resolveAdaptiveOrchestrationOptions({
      ...(profile.orchestration === "adaptive" &&
      (opts.provider.name === "xai" || (opts.model ?? "").startsWith("grok-"))
        ? { automaticDelegation: false, maxAutomaticDelegations: 1 }
        : {}),
      ...opts.adaptiveOrchestration,
    }),
    subagentGovernance: opts.subagentGovernance,
    sessionId,
    planId: opts.planId ?? planIdForSession(sessionId),
    enableCheckpoints: opts.enableCheckpoints ?? true,
    enablePromptCache: opts.enablePromptCache ?? true,
    persistSessions: opts.persistSessions ?? true,
    performance: resolvePerformanceOptions(opts.performance),
    budget: new BudgetTracker(sessionBudget, resolveModelPricing(opts.model)),
    checkpoints: new CheckpointManager(workspaceRoot, agentDir),
    createdAt: new Date().toISOString(),
  };
}
