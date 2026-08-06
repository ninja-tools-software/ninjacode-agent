/**
 * Wire protocol between the chat webview and the extension host.
 *
 * This module is imported by both sides (the host via `./protocol.js`, the webview via
 * `../../src/protocol.js`), so it must stay **type-only at runtime**: no `import * as vscode`,
 * no Node builtins, no value exports that pull either in. Both directions are discriminated
 * unions on `type`, which turns a forgotten branch in either router into a compile error.
 */
import type {
  AgentLogEntry,
  AgentMode,
  ApprovalMode,
  PlanSummary,
  RunState,
  SessionSummary,
} from "@ninjacode/core";
import type {
  ArenaScore,
  ModelBenchmark,
  ProviderKind,
  ReasoningEffort,
} from "@ninjacode/providers";

// ---------------------------------------------------------------------------
// Shared data shapes
// ---------------------------------------------------------------------------

/** How a user message should be handled when its session is already busy. */
export type SendMode = "queue" | "steer" | "stop_and_send";

export type ToolCardStatus = "running" | "done" | "error";

export interface ToolLogFields {
  id: string;
  name: string;
  label: string;
  target?: string;
  status: ToolCardStatus;
  argsPreview?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  /** Human-readable line range consulted/edited, e.g. "L10-50". */
  lineRange?: string;
}

export interface Hypothesis {
  id: string;
  description: string;
  status: string;
}

export interface TodoUiItem {
  id: string;
  content: string;
  status: string;
}

export type UiToolLogItem = { kind: "tool" } & ToolLogFields;

/** A tool card update. Only `id` is guaranteed: `tool_start` and `tool_end` each
 * carry a different subset, merged into the existing card by id. */
export interface ToolEventPayload extends Partial<ToolLogFields> {
  id: string;
  /** Raw tool call arguments, used to derive a target/preview when absent. */
  arguments?: Record<string, unknown>;
}

export interface UiQuestionOption {
  id: string;
  label: string;
}

export interface UiQuestion {
  id: string;
  prompt: string;
  options: UiQuestionOption[];
  allowMultiple?: boolean;
}

export interface UiQuestionAnswer {
  questionId: string;
  selectedLabels?: string[];
  freeText?: string;
}

/** Typed NinjaCode gateway failure surfaced to the chat UI. */
export interface GatewayErrorInfo {
  code:
    | "insufficient_credits"
    | "rate_limited"
    | "model_not_priced"
    | "model_not_in_catalog"
    | "account_suspended"
    | "unauthorized"
    | "upstream_timeout";
  renewsAt?: string;
  planTier?: string;
  model?: string;
  catalog?: string;
  /** Output already reached the user: the answer above is truncated. */
  partial?: boolean;
}

export type UiLogItem =
  | { kind: "user"; text: string; refs?: ContextRef[] }
  | { kind: "assistant"; text: string }
  | { kind: "reasoning"; text: string }
  | UiToolLogItem
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
  | {
      kind: "approval";
      requestId: string;
      toolName: string;
      target: string;
      reason: string;
      grantScope?: string;
      resolved?: boolean;
      approved?: boolean;
      cancelled?: boolean;
      remember?: boolean;
    }
  | {
      kind: "question";
      requestId: string;
      questions: UiQuestion[];
      resolved?: boolean;
      cancelled?: boolean;
      answers?: UiQuestionAnswer[];
    }
  | {
      kind: "user_action";
      requestId: string;
      action: string;
      reason?: string;
      resolved?: boolean;
      cancelled?: boolean;
      comment?: string;
    };

/**
 * How full the context window is right now. Distinct from `SessionUsagePayload`,
 * which is what the session has *consumed* so far — one is a snapshot, the other
 * a running total.
 */
export interface ContextUsage {
  system: number;
  history: number;
  tools: number;
  files: number;
  output: number;
  total: number;
  window: number;
}

/** Tokens billed across the whole session, accumulated from every turn's provider usage. */
export interface SessionUsagePayload {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Model the tokens were spent on, for the expanded view. */
  model?: string;
  /** Last model chosen by Auto routing (when model is `auto`). */
  resolvedModel?: string;
}

export interface QueuedMessage {
  id: string;
  text: string;
  mode?: AgentMode;
  queuedAt: number;
}

export interface ChangeItem {
  path: string;
  additions: number;
  deletions: number;
  sensitive: boolean;
  sessionId?: string;
}

/** A contiguous run of changed lines between the working baseline and the proposal. */
export interface HunkItem {
  id: string;
  currentStart: number;
  currentLines: string[];
  afterStart: number;
  afterLines: string[];
}

export interface SlashPromptItem {
  name: string;
  description?: string;
  argumentHint?: string;
  body?: string;
}

export interface SlashBuiltinItem {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Context references (the `+` picker, @mentions, drag & drop and native commands
// all converge on this single shape)
// ---------------------------------------------------------------------------

/** Every kind of context that can be attached to a prompt. */
export type RefKind =
  | "file"
  | "folder"
  | "symbol"
  | "open_tab"
  | "recent"
  | "diagnostics"
  | "scm_diff"
  | "codebase"
  | "url"
  | "selection"
  | "snippet"
  | "image"
  | "terminal";

/** Kinds the `+` picker can search interactively (a subset of `RefKind`). */
export type ContextQueryType =
  | "file"
  | "folder"
  | "symbol"
  | "open_tab"
  | "recent"
  | "diagnostics"
  | "scm_diff"
  | "codebase"
  | "url";

export interface ContextSuggestion {
  id: string;
  label: string;
  detail?: string;
}

export type RefStatus = "pending" | "resolved" | "error";

/**
 * A single piece of attached context, rendered as an atomic badge inside the composer.
 * `id` is the dedup key and stays stable across insertions of the same target.
 */
export interface ContextRef {
  id: string;
  kind: RefKind;
  /** Short text shown inside the badge (basename, symbol name, "3 problems", ...). */
  label: string;
  /** Tooltip / full path shown on hover. */
  detail?: string;
  /** Provider-specific resolution key (workspace-relative path, url, `file:line`, ...). */
  target: string;
  status: RefStatus;
  /** Line range for selections and symbols (1-based, inclusive). */
  range?: { start: number; end: number };
  /** Rough token cost of the resolved content, shown in the badge tooltip. */
  tokens?: number;
  /** Images only: `data:` URL captured in the webview. */
  dataUrl?: string;
  mimeType?: string;
  /** Set when `status` is `"error"`. */
  error?: string;
}

/** A raw item extracted from a drop's `DataTransfer`, before the host resolves it. */
export interface DropItem {
  /** `uri` for editor/explorer drops, `file` for OS drops, `text` for plain-text drops. */
  kind: "uri" | "file" | "text";
  value: string;
  /** File drops only. */
  name?: string;
  mimeType?: string;
  /** File drops only: `data:` URL for images read in the webview. */
  dataUrl?: string;
  /** File drops only: contents read in the webview, when the OS gave us no path. */
  text?: string;
}

/** One node of the composer document: literal text, or an atomic context badge. */
export type ComposerNode =
  | { kind: "text"; text: string }
  | { kind: "ref"; ref: ContextRef };

// ---------------------------------------------------------------------------
// Settings payload
// ---------------------------------------------------------------------------

export interface WireModelInfo {
  id: string;
  label: string;
  contextWindow: number;
  maxOutput: number;
  /** Accepts image parts. Absent for models discovered outside the catalog. */
  vision?: boolean;
  reasoning?:
    | { kind: "levels"; levels: ReasoningEffort[]; default?: ReasoningEffort }
    | { kind: "budget"; min: number; max: number; default: number };
  /** Recommended context for the UI Default label; falls back to contextWindow. */
  defaultContextWindow?: number;
  hostingRegion?: string | null;
  catalog?: string;
  tags?: string[];
  /** Relative cost signal (USD/M input+output). null for Auto / unpriced. */
  costIndex?: number | null;
  /** Artificial Analysis indices; null when not synced yet. */
  benchmark?: ModelBenchmark | null;
  /** Design Arena ELO/win-rate per category. */
  arenaScores?: ArenaScore[];
}

export interface ProviderCatalogItem {
  kind: string;
  label: string;
  models: WireModelInfo[];
}

export interface AccountInfoPayload {
  email: string;
  credits: number;
  creditsIncluded: number;
  renewsAt: string | null;
  passTier: string | null;
  passStreakMonths: number;
}

export interface UsageRowPayload {
  model?: string;
  createdAt?: string;
  credits?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** Which VS Code side bar hosts the NinjaCode chat panel. */
export type ChatLocation = "primary" | "secondary";

/** The full settings snapshot both the chat composer and the Settings tab render. */
export interface SettingsPayload {
  provider: string;
  providers: string[];
  model: string;
  baseUrl: string;
  baseUrls: Record<string, string>;
  chatLocation: ChatLocation;
  /** Physical screen side where the chat panel currently appears. */
  chatSide: "left" | "right";
  /** Which side of the workbench the Primary Side Bar occupies. */
  primarySidebarSide: "left" | "right";
  mode: AgentMode;
  approvalMode: ApprovalMode;
  reasoningEffort: ReasoningEffort;
  thinkingBudgetTokens: number;
  contextWindow: number;
  catalogs: ProviderCatalogItem[];
  /** Display name per provider kind, including providers that are disabled. */
  providerLabels: Record<string, string>;
  models: WireModelInfo[];
  modelInfo?: WireModelInfo;
  /** Model ids the user starred, surfaced at the top of the picker. */
  favoriteModels: string[];
  contextPresets: number[];
  hasApiKey: Record<string, boolean>;
  account: AccountInfoPayload | null;
  usage: UsageRowPayload[];
  gatewayConfigured: boolean;
  /**
   * Contractual attribution for Artificial Analysis / Design Arena data.
   * Displayed verbatim in the benchmark panel when a model has data.
   */
  benchmarkAttribution?: string | null;
  /** Effective UI locale after resolving `ninjacode.locale` (auto → VS Code language). */
  locale: "en" | "fr";
  /** Raw `ninjacode.locale` setting value (before auto-resolution). */
  localeSetting: "auto" | "en" | "fr";
}

// ---------------------------------------------------------------------------
// Webview → host
// ---------------------------------------------------------------------------

/** Settings mutations, shared with the Settings editor tab. */
export type SettingsToHost =
  | {
      type: "update_settings";
      provider?: ProviderKind;
      providers?: ProviderKind[];
      configKind?: ProviderKind;
      model?: string;
      baseUrl?: string;
      chatLocation?: ChatLocation;
      mode?: AgentMode;
      approvalMode?: ApprovalMode;
      reasoningEffort?: ReasoningEffort;
      thinkingBudgetTokens?: number;
      contextWindow?: number;
    }
  | { type: "set_api_key"; kind: ProviderKind; key: string }
  | { type: "clear_api_key"; kind: ProviderKind }
  | { type: "account_browser_login" }
  | { type: "account_login"; email: string }
  | { type: "account_paste_key"; key: string }
  | { type: "account_logout" }
  | { type: "account_refresh" }
  | { type: "account_subscribe"; tier: string }
  | { type: "set_mode"; mode: AgentMode }
  | { type: "set_model"; model: string }
  | { type: "set_favorite_models"; models: string[] }
  | { type: "set_reasoning"; reasoningEffort?: ReasoningEffort; thinkingBudgetTokens?: number }
  | { type: "set_context_window"; contextWindow: number }
  | { type: "toggle_sidebar_position" }
  | { type: "set_locale"; locale: "auto" | "en" | "fr" };

export type ChatToHost =
  // lifecycle
  | { type: "ready" }
  | { type: "get_settings" }
  | { type: "open_settings" }
  | { type: "chat_focus"; focused: boolean }
  | { type: "copy_to_clipboard"; text: string }
  // conversation
  | {
      type: "user_message";
      text: string;
      /** Composer document, with context badges in their authored position. */
      nodes: ComposerNode[];
      refs: ContextRef[];
      sendMode?: SendMode;
    }
  | { type: "new_session" }
  | { type: "compact_conversation" }
  | { type: "stop" }
  // queue
  | { type: "reorder_queue"; queueId: string; direction: "up" | "down" }
  | { type: "remove_queued"; queueId: string }
  // interactive cards
  | { type: "approve"; requestId: string }
  | { type: "deny"; requestId: string }
  | { type: "approve_always"; requestId: string }
  | { type: "question_answer"; requestId: string; answers: UiQuestionAnswer[] }
  | { type: "user_action_done"; requestId: string; comment?: string }
  // proposed edits
  | { type: "review_edit"; path: string }
  | { type: "accept_all" }
  | { type: "reject_all" }
  | { type: "cancel_auto_accept" }
  | { type: "accept_edit"; path: string }
  | { type: "reject_edit"; path: string }
  | { type: "get_hunks"; path: string }
  | { type: "accept_hunk"; path: string; hunkId: string }
  | { type: "reject_hunk"; path: string; hunkId: string }
  | { type: "send_feedback"; path: string; text: string }
  // sessions
  | { type: "list_sessions" }
  | { type: "switch_session"; sessionId: string }
  | { type: "delete_session"; sessionId: string }
  | { type: "fork_session"; sessionId: string; messageIndex?: number }
  | { type: "edit_and_resend"; sessionId: string; messageIndex: number; text: string }
  | { type: "rename_session"; sessionId: string; title: string }
  | { type: "pin_session"; sessionId: string; pinned?: boolean }
  | { type: "archive_session"; sessionId: string; archived?: boolean }
  | { type: "export_session"; sessionId: string; format?: "json" | "markdown" }
  // context attachment
  | { type: "mention_query"; query: string }
  | { type: "context_query"; queryType: ContextQueryType; query: string }
  | {
      type: "resolve_context_item";
      queryType: ContextQueryType;
      contextId: string;
      contextLabel?: string;
      requestId: string;
    }
  | { type: "get_current_selection"; requestId: string }
  | { type: "resolve_drop"; requestId: string; items: DropItem[] }
  | { type: "resolve_refs"; requestId: string; refs: ContextRef[] }
  | { type: "open_ref"; ref: ContextRef }
  | { type: "ref_preview"; requestId: string; ref: ContextRef }
  | { type: "pick_files_native"; requestId: string }
  | { type: "dismiss_drag_tip" }
  // plan
  | { type: "execute_plan"; model?: string }
  | { type: "open_plan"; planId?: string }
  | { type: "list_plans" }
  | { type: "activate_plan"; planId: string }
  | { type: "rename_plan"; planId: string; title: string }
  | { type: "delete_plan"; planId: string }
  | { type: "open_plan_markdown" }
  // mermaid
  | { type: "open_mermaid"; source: string }
  // voice
  | { type: "voice_start" }
  | { type: "voice_stop" }
  | { type: "voice_cancel" }
  // prompt enhancement (gateway only)
  | { type: "enhance_prompt"; requestId: string; text: string; mode?: AgentMode }
  // gateway error CTAs
  | { type: "gateway_upgrade"; tier?: string }
  | { type: "gateway_open_account" }
  | { type: "gateway_change_model" }
  | { type: "gateway_sign_in" };

export type WebviewToHost = ChatToHost | SettingsToHost;

// ---------------------------------------------------------------------------
// Host → webview
// ---------------------------------------------------------------------------

export interface HydratePayload {
  log: UiLogItem[];
  todos: TodoUiItem[];
  pendingEdits: string[];
  hypotheses: Hypothesis[];
  debugLogCount: number;
  activeSessionId?: string;
  sessions: SessionSummary[];
  runState: RunState;
  queue: QueuedMessage[];
  contextUsage: ContextUsage | null;
  sessionUsage: SessionUsagePayload | null;
  /** One-shot onboarding hint: hold Shift to drag from the Explorer. */
  showDragTip: boolean;
}

export type HostToWebview =
  // hydration / session
  | ({ type: "hydrate" } & HydratePayload)
  | ({ type: "settings" } & SettingsPayload)
  | { type: "set_locale"; locale: "en" | "fr" }
  | { type: "sessions"; sessions: SessionSummary[]; activeSessionId?: string }
  | { type: "sessions_loading"; loading: boolean }
  | { type: "session_changed"; activeSessionId?: string }
  | { type: "clear" }
  | { type: "mode"; mode: AgentMode }
  // streaming
  | { type: "user"; text: string; refs?: ContextRef[] }
  | { type: "assistant_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "assistant_done" }
  | ({ type: "tool" } & ToolEventPayload)
  | { type: "status"; text: string }
  | {
      type: "routing";
      model: string;
      label?: string;
      reason?: string;
      tier?: string;
      estimatedCredits?: number;
    }
  | { type: "error"; text: string }
  | { type: "gateway_error"; info: GatewayErrorInfo }
  | { type: "open_model_menu" }
  | { type: "run_state"; state: RunState }
  | { type: "queue"; queue: QueuedMessage[] }
  | ({ type: "context_usage" } & ContextUsage)
  | ({ type: "usage" } & SessionUsagePayload)
  | { type: "checkpoint"; id: string; label: string }
  | { type: "agent_log_entry"; entry: AgentLogEntry }
  // interactive cards
  | {
      type: "approval";
      requestId: string;
      toolName: string;
      target: string;
      reason: string;
      /** Human label of what "Always" will remember (e.g. `git status`, `cat, grep`). */
      grantScope?: string;
    }
  | {
      type: "approval_resolved";
      requestId: string;
      approved?: boolean;
      cancelled?: boolean;
      remember?: boolean;
    }
  | { type: "question"; requestId: string; questions: UiQuestion[] }
  | {
      type: "question_resolved";
      requestId: string;
      answers?: UiQuestionAnswer[];
      cancelled?: boolean;
    }
  | { type: "user_action"; requestId: string; action: string; reason?: string }
  | { type: "user_action_resolved"; requestId: string; comment?: string; cancelled?: boolean }
  // composer / context
  | { type: "compose"; text: string }
  | { type: "mention_suggestions"; items: string[] }
  | { type: "context_suggestions"; queryType: ContextQueryType; items: ContextSuggestion[] }
  | { type: "context_resolved"; requestId: string; ref: ContextRef | null }
  | { type: "refs_resolved"; requestId: string; refs: ContextRef[] }
  | { type: "context_insert"; refs: ContextRef[]; at: "caret" | "end" }
  | { type: "ref_preview_result"; requestId: string; preview: string; tokens?: number }
  | { type: "slash_commands"; builtins: SlashBuiltinItem[]; prompts: SlashPromptItem[] }
  // panels
  | { type: "todos"; items: TodoUiItem[] }
  | { type: "plan"; planId: string; title: string; path: string; content: string }
  | { type: "plan_clear" }
  | {
      type: "plan_doc";
      planId: string;
      title: string;
      relPath: string;
      content: string;
      models: WireModelInfo[];
      model: string;
      busy: boolean;
    }
  | { type: "plans"; items: PlanSummary[] }
  | { type: "changes"; changes: ChangeItem[] }
  | { type: "pending_edits"; paths: string[] }
  | { type: "hunks"; path: string; hunks: HunkItem[] }
  | { type: "auto_accept"; deadline: number | null }
  | { type: "debug_hypotheses"; hypotheses: Hypothesis[] }
  | { type: "debug_log"; count: number }
  // mermaid
  | { type: "mermaid_doc"; source: string }
  // voice
  | { type: "voice_partial"; text: string }
  | { type: "voice_final"; text: string }
  | { type: "voice_level"; level: number }
  | { type: "voice_error"; text: string }
  | { type: "voice_setup_progress"; label: string | null; percent?: number }
  // prompt enhancement (gateway only)
  | { type: "enhance_prompt_result"; requestId: string; text: string }
  | { type: "enhance_prompt_error"; requestId: string; text: string };

