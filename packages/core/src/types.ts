import type { Message, TokenUsage, ToolCall } from "@ninjacode/providers";
import type { ToolErrorCategory } from "./toolErrors.js";

export type AgentMode = "agent" | "plan" | "ask" | "debug";

/** Lifecycle state of an agent run, driven by AbortController + tool/approval flow. */
export type RunState =
  | "idle"
  | "running"
  | "waiting"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed";

export interface StateChangePayload {
  state: RunState;
  previous: RunState;
}

export interface SessionConfig {
  id: string;
  workspaceRoot: string;
  mode: AgentMode;
  model?: string;
  /** Provider kind/name when known (optional for legacy sessions). */
  provider?: string;
  /** Stable display title (optional for legacy sessions). */
  title?: string;
  /** Active plan id under `.ninjacode/plans/` (defaults to hash of session id). */
  planId?: string;
  createdAt: string;
}

export interface ToolInvocation {
  toolCall: ToolCall;
  output: string;
  approved: boolean;
  durationMs: number;
  /** Time spent waiting for user approval, excluded from execution time. */
  approvalWaitMs?: number;
  error?: string;
  /** Immutable archive of the full, pre-truncation output. */
  artifactId?: string;
  /** Structured metadata from the tool result (e.g. served read range). */
  meta?: Record<string, unknown>;
}

export interface TurnTrace {
  turn: number;
  assistantText: string;
  toolInvocations: ToolInvocation[];
  usage: TokenUsage;
  /** Model used for this turn (after Auto routing when applicable). */
  model?: string;
}

export interface ToolStartEventPayload {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  target: string;
}

export interface ToolEndEventPayload {
  id: string;
  name: string;
  output?: string;
  error?: string;
  category?: ToolErrorCategory;
  meta?: Record<string, unknown>;
}

export interface CheckpointFailure {
  stage: "init" | "create" | "emit";
  message: string;
}

export interface AgentEvent {
  type:
    | "thinking"
    | "text_delta"
    | "reasoning_delta"
    | "routing"
    | "tool_start"
    | "tool_end"
    | "approval_required"
    | "checkpoint"
    | "checkpoint_error"
    | "done"
    | "error"
    | "status"
    | "debug_hypotheses"
    | "debug_log"
    | "state_change"
    | "context_usage"
    | "compaction"
    | "usage"
    | "agent_log"
    | "hook_run"
    | "subagent_start"
    | "subagent_progress"
    | "subagent_end";
  payload: unknown;
}

export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

export interface ApprovalRequest {
  toolName: string;
  target: string;
  arguments: Record<string, unknown>;
  reason: string;
  /**
   * Coarse "command type" scopes this call belongs to (see `Tool.grantScopes`).
   * When non-empty, approving with "remember" should grant these scopes rather
   * than the exact `target`. Empty/absent means remember the exact target.
   */
  grantScopes?: string[];
  /** False when this dynamic call must be approved again on every execution. */
  canRemember?: boolean;
  /**
   * The call was classified as irreversible (see `Tool.riskFor`) — hosts should
   * warn more loudly than for an ordinary approval, and it can never be
   * satisfied by a coarse "always allow" given earlier.
   */
  danger?: boolean;
}

export type ApprovalHandler = (req: ApprovalRequest) => Promise<{
  approved: boolean;
  remember?: boolean;
}>;

export interface AgentOutcome {
  answer: string;
  turns: TurnTrace[];
  completed: boolean;
  sessionId: string;
}

/**
 * Links a user request to the shadow-git checkpoint captured just before it ran.
 * Lets "edit & resend" / restore map a specific message back to the exact
 * workspace snapshot, instead of indexing a workspace-global checkpoint list.
 */
export interface RequestCheckpoint {
  /** Checkpoint id captured before this request's edits. */
  checkpointId: string;
  /** Raw index into `history` of the user message this request appended. */
  userMessageIndex: number;
}

export interface SessionState {
  config: SessionConfig;
  history: Message[];
  turns: TurnTrace[];
}
