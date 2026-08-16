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
import type { VerifyConfig } from "./verify.js";
import type { VolatileContext } from "./volatileContext.js";
import type { AgentOutcome, RunState, TurnTrace } from "./types.js";
import type { Message } from "@ninjacode/providers";

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
  globalTurn: number;
  toolCallFingerprints: string[];
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
  reasoningEffort?: ReasoningEffort;
  thinkingBudgetTokens?: number;
  contextWindow?: number;
  pinnedTask?: string;
  enableLoopDetection: boolean;
  enableCompletionVerification: boolean;
  enableVerificationSubAgent: boolean;
  modifiedFiles: Set<string>;
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
  runHooks: (
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ) => Promise<HookRunResult[]>;
  runCompletionVerification: (config: VerifyConfig) => Promise<{ ok: boolean; messages: string[] }>;
  runVerificationSubAgent: (answer: string) => Promise<string | undefined>;
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
      | "usage",
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
