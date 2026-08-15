/**
 * UI-side types. Wire shapes come from the shared protocol; only what exists
 * purely in the webview (transient UI state) is declared here.
 */
import type { SessionSummary, PlanSummary } from "@ninjacode/core";
import type {
  ChangeItem,
  ComposerNode,
  ContextQueryType,
  ContextRef,
  ContextSuggestion,
  ContextUsage,
  DropItem,
  GatewayErrorInfo,
  HostToWebview,
  HunkItem,
  Hypothesis,
  QueuedMessage,
  RefKind,
  SendMode,
  SessionUsagePayload,
  SlashBuiltinItem,
  SlashPromptItem,
  UiQuestion,
  UiQuestionAnswer,
  UiToolLogItem,
  WebviewToHost,
} from "../../../src/protocol.js";
import type { Mode, ModelInfo, ModelSortId, SettingsState } from "../types.js";

export type {
  ChangeItem,
  ComposerNode,
  ContextQueryType,
  ContextRef,
  ContextSuggestion,
  ContextUsage,
  DropItem,
  GatewayErrorInfo,
  HostToWebview,
  HunkItem,
  Hypothesis,
  Mode,
  ModelInfo,
  ModelSortId,
  QueuedMessage,
  RefKind,
  SendMode,
  SessionSummary,
  PlanSummary,
  /** Running token totals for the session; `ContextUsage` is the window snapshot. */
  SessionUsagePayload as SessionUsage,
  SettingsState,
  SlashBuiltinItem,
  SlashPromptItem,
  UiQuestion,
  UiQuestionAnswer,
  WebviewToHost,
};

export type RunState = "idle" | "running" | "waiting" | "stopping" | "stopped" | "completed" | "failed";
export type VoiceState = "idle" | "recording" | "transcribing";
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type ToolLogItem = UiToolLogItem;

export interface QuestionLogItem {
  kind: "question";
  requestId: string;
  questions: UiQuestion[];
  resolved?: boolean;
  cancelled?: boolean;
  answers?: UiQuestionAnswer[];
}

export interface UserActionLogItem {
  kind: "user_action";
  requestId: string;
  action: string;
  reason?: string;
  resolved?: boolean;
  cancelled?: boolean;
  comment?: string;
}

export interface ApprovalLogItem {
  kind: "approval";
  requestId: string;
  toolName: string;
  target: string;
  reason: string;
  /** Human label of what "Always" will remember (command type), when applicable. */
  grantScope?: string;
  /** False when the command is dynamic and must be approved every time. */
  canRemember?: boolean;
  /** The call is irreversible — the card warns and does not offer "Always". */
  danger?: boolean;
  resolved?: boolean;
  approved?: boolean;
  cancelled?: boolean;
  remember?: boolean;
}

export type LogItem =
  | { kind: "user"; text: string; refs?: ContextRef[] }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | ToolLogItem
  | { kind: "status"; text: string }
  | {
      kind: "routing";
      model: string;
      label?: string;
      reason?: string;
      tier?: string;
      estimatedCredits?: number;
    }
  | { kind: "error"; text: string }
  | ({ kind: "gateway_error" } & GatewayErrorInfo)
  | ApprovalLogItem
  | QuestionLogItem
  | UserActionLogItem;

export interface PlanState {
  id: string;
  title: string;
  path: string;
  content: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

/**
 * `postMessage`, narrowed to messages the host actually understands. `getState`
 * / `setState` are the webview's own persistence, used for composer drafts.
 */
export interface VsCodeApi {
  postMessage: (msg: WebviewToHost) => void;
  getState?: () => unknown;
  setState?: (state: unknown) => void;
}

export const CONTEXT_TYPES: Array<{ id: ContextQueryType; label: string }> = [
  { id: "file", label: "Files" },
  { id: "folder", label: "Folders" },
  { id: "symbol", label: "Symbols" },
  { id: "open_tab", label: "Open tabs" },
  { id: "recent", label: "Recent" },
  { id: "diagnostics", label: "Problems" },
  { id: "scm_diff", label: "Git diff" },
  { id: "codebase", label: "Codebase search" },
  { id: "url", label: "URL" },
];
