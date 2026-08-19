import type {
  LlmProvider,
  ReasoningEffort,
  TokenUsage,
  ToolSpec,
} from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import type { BudgetTracker } from "./reliability.js";
import type { HookRunResult } from "./hooks.js";
import type { ToolPipeline } from "./toolPipeline.js";
import type { VerificationResult, VerifyConfig } from "./verify.js";
import type { VolatileContext } from "./volatileContext.js";
import type { AgentOutcome, RunState, TurnTrace } from "./types.js";
import type { Message } from "@ninjacode/providers";
import type {
  AdaptiveDelegationRole,
  OrchestrationProfile,
  PhasePolicyState,
  ResolvedAdaptiveOrchestrationOptions,
} from "./phasePolicy.js";
import type {
  ResolvedIndependentVerifierOptions,
  VerificationMode,
} from "./agentOptions.js";
import type { ResolvedLlmTurnStallOptions } from "./llmTurnGuard.js";
import type { IndependentVerifierRunResult } from "./agentSupport.js";

export interface AgentTurnMutableState {
  history: Message[];
  turns: TurnTrace[];
  /** Byte-stable for the whole run — see `buildSystemPrompt`. */
  system: string;
  /** Last scratchpad/plan snapshot the model was told about. */
  volatileContext: VolatileContext;
  emptyResponseRetries: number;
  stopHookRetries: number;
  verificationRetries: number;
  /** Consecutive LLM turns that produced nothing before their time ran out. */
  llmStallRetries: number;
  globalTurn: number;
  toolCallFingerprints: string[];
  phasePolicy?: PhasePolicyState;
}

export interface AgentTurnDeps {
  turn: number;
  signal: AbortSignal;
  state: AgentTurnMutableState;
  workspaceRoot: string;
  toolSpecs: ToolSpec[];
  modeTools: ToolRegistry;
  verifyConfig: VerifyConfig;
  provider: LlmProvider;
  maxTokens: number;
  maxTurns: number;
  model?: string;
  utilityModel?: string;
  enablePromptCache: boolean;
  minimalVolatileContext: boolean;
  reasoningEffort?: ReasoningEffort;
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
  modifiedFiles: Set<string>;
  activeFilesProvider?: () =>
    | readonly string[]
    | Promise<readonly string[]>;
  budget: BudgetTracker;
  toolPipeline: ToolPipeline;
  readScratchpad: () => Promise<string>;
  readActivePlan: () => Promise<string>;
  estimateUsage: (
    system: string,
    history: Message[],
    toolSpecs: ToolSpec[],
  ) => import("./contextEstimate.js").ContextUsageBreakdown;
  trackUsage: (
    usage: TokenUsage,
    opts?: { category?: "compaction"; model?: string; durationMs?: number },
  ) => void;
  getCacheStats: () => Record<string, unknown>;
  checkRunTimeout: () => string | undefined;
  /** Milliseconds left on the run clock; `Infinity` when the run is untimed. */
  remainingRunMs: () => number;
  runHooks: (
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ) => Promise<HookRunResult[]>;
  runCompletionVerification: (config: VerifyConfig) => Promise<VerificationResult>;
  runVerificationSubAgent: (verification: VerificationResult) => Promise<IndependentVerifierRunResult>;
  runAdaptiveSubAgent: (
    role: AdaptiveDelegationRole,
    reason: string,
  ) => Promise<string>;
  recordSessionEvent: (
    type: "assistant_message" | "compaction",
    payload: Record<string, unknown>,
  ) => Promise<void>;
  archiveCompaction: (
    messages: Message[],
    info: Record<string, unknown>,
  ) => Promise<void>;
  persist: () => Promise<void>;
  setState: (next: RunState) => Promise<void>;
  emit: (
    type:
      | "thinking"
      | "text_delta"
      | "reasoning_delta"
      | "routing"
      | "context_usage"
      | "status"
      | "error"
      | "done"
      | "compaction"
      | "usage"
      | "phase_change"
      | "verification_start"
      | "verification_end",
    payload: unknown,
  ) => Promise<void>;
  logAgentEvent: (
    type: "llm_call" | "llm_response" | "cache" | "cancel" | "error",
    summary: string,
    detail?: string,
  ) => void;
  isAbortError: (error: unknown) => boolean;
  outcome: (answer: string, completed: boolean) => AgentOutcome;
}

export type AgentTurnOutcome =
  | { kind: "continue" }
  | { kind: "done"; answer: string }
  | { kind: "failed"; message: string }
  | { kind: "stopped"; message: string };
