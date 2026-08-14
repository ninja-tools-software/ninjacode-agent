import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveModelPricing, type LlmProvider, type ReasoningEffort } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider } from "@ninjacode/tools";
import { planIdForSession } from "@ninjacode/tools";
import { BudgetTracker, withRetry, type SessionBudget } from "./reliability.js";
import { CheckpointManager } from "./checkpoints.js";
import type { AgentMode, AgentEventHandler, ApprovalHandler } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import type { ToolRegistry } from "@ninjacode/tools";
import type { ContentPart } from "@ninjacode/providers";

/** Input to `Agent.run` — a plain string, or text plus multimodal image parts. */
export interface AgentTaskInput {
  text: string;
  images?: ContentPart[];
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
  persistSessions?: boolean;
  budget?: SessionBudget;
  enableRetry?: boolean;
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  runTimeoutMs?: number;
  enableCompletionVerification?: boolean;
  enableVerificationSubAgent?: boolean;
  enableLoopDetection?: boolean;
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
  runTimeoutMs: number;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  enableLoopDetection: boolean;
  sessionId: string;
  planId: string;
  enableCheckpoints: boolean;
  enablePromptCache: boolean;
  persistSessions: boolean;
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

function resolveBudget(budget: SessionBudget | undefined): SessionBudget {
  return { maxCostUsd: DEFAULT_MAX_COST_USD, ...budget };
}

function resolveProvider(opts: AgentOptions): LlmProvider {
  return opts.enableRetry === false ? opts.provider : withRetry(opts.provider);
}

function resolveMode(opts: AgentOptions): AgentMode {
  return opts.mode ?? "agent";
}

function resolveCompletionVerification(opts: AgentOptions, mode: AgentMode): boolean {
  return opts.enableCompletionVerification ?? (mode === "agent" || mode === "debug");
}

export function resolveAgentConfig(opts: AgentOptions): ResolvedAgentConfig {
  const workspaceRoot = path.resolve(opts.workspaceRoot);
  const agentDir = opts.agentDir ?? path.join(workspaceRoot, ".ninjacode");
  const mode = resolveMode(opts);
  const sessionId = opts.sessionId ?? randomUUID();

  return {
    provider: resolveProvider(opts),
    workspaceRoot,
    agentDir,
    mode,
    maxTurns: opts.maxTurns ?? 64,
    maxTokens: opts.maxTokens ?? 8192,
    model: opts.model,
    utilityModel: opts.utilityModel,
    reasoningEffort: opts.reasoningEffort,
    thinkingBudgetTokens: opts.thinkingBudgetTokens,
    contextWindow: opts.contextWindow,
    codebaseIndex: opts.codebaseIndex,
    diagnosticsProvider: opts.diagnosticsProvider,
    runTimeoutMs: opts.runTimeoutMs ?? 0,
    enableCompletionVerification: resolveCompletionVerification(opts, mode),
    enableVerificationSubAgent: opts.enableVerificationSubAgent ?? false,
    enableLoopDetection: opts.enableLoopDetection ?? true,
    sessionId,
    planId: opts.planId ?? planIdForSession(sessionId),
    enableCheckpoints: opts.enableCheckpoints ?? true,
    enablePromptCache: opts.enablePromptCache ?? true,
    persistSessions: opts.persistSessions ?? true,
    budget: new BudgetTracker(resolveBudget(opts.budget), resolveModelPricing(opts.model)),
    checkpoints: new CheckpointManager(workspaceRoot, agentDir),
    createdAt: new Date().toISOString(),
  };
}
