import type { HostToWebview, UiLogItem } from "./protocol.js";
import { upsertToolInLog } from "./toolLogUi.js";
import { appendReasoningToLog } from "./reasoningUi.js";
import type { RuntimeUiState } from "./sessionRuntime.js";

type MirrorHandler = (ui: RuntimeUiState, payload: HostToWebview) => void;

const HANDLERS: Partial<Record<HostToWebview["type"], MirrorHandler>> = {
  clear: (ui) => {
    ui.log = [];
    ui.todos = [];
    ui.pendingEdits = [];
    ui.hypotheses = [];
    ui.debugLogCount = 0;
    ui.contextUsage = null;
    ui.sessionUsage = null;
  },
  context_usage: (ui, payload) => {
    if (payload.type !== "context_usage") return;
    const { type: _type, ...usage } = payload;
    ui.contextUsage = usage;
  },
  usage: (ui, payload) => {
    if (payload.type !== "usage") return;
    const { type: _type, ...usage } = payload;
    ui.sessionUsage = usage;
  },
  user: (ui, payload) => {
    if (payload.type !== "user") return;
    ui.log.push({ kind: "user", text: payload.text, refs: payload.refs });
  },
  assistant_delta: (ui, payload) => {
    if (payload.type !== "assistant_delta" || !payload.text) return;
    const last = ui.log[ui.log.length - 1];
    if (last?.kind === "assistant") last.text += payload.text;
    else ui.log.push({ kind: "assistant", text: payload.text });
  },
  reasoning_delta: (ui, payload) => {
    if (payload.type !== "reasoning_delta" || !payload.text) return;
    ui.log = appendReasoningToLog(ui.log, payload.text);
  },
  tool: (ui, payload) => {
    if (payload.type !== "tool") return;
    ui.log = upsertToolInLog(ui.log, payload);
  },
  status: (ui, payload) => {
    if (payload.type !== "status") return;
    mirrorStatus(ui, payload.text);
  },
  error: (ui, payload) => {
    if (payload.type !== "error") return;
    ui.log.push({ kind: "error", text: payload.text });
  },
  approval: (ui, payload) => {
    if (payload.type !== "approval") return;
    ui.log.push({
      kind: "approval",
      requestId: payload.requestId,
      toolName: payload.toolName,
      target: payload.target,
      reason: payload.reason,
      grantScope: payload.grantScope,
    });
  },
  approval_resolved: (ui, payload) => {
    if (payload.type !== "approval_resolved") return;
    resolveApprovalItem(ui.log, payload.requestId, {
      resolved: true,
      approved: payload.approved,
      cancelled: Boolean(payload.cancelled),
      remember: payload.remember,
    });
  },
  question: (ui, payload) => {
    if (payload.type !== "question") return;
    ui.log.push({ kind: "question", requestId: payload.requestId, questions: payload.questions });
  },
  question_resolved: (ui, payload) => {
    if (payload.type !== "question_resolved") return;
    resolveQuestionItem(ui.log, payload.requestId, Boolean(payload.cancelled), payload.answers);
  },
  user_action: (ui, payload) => {
    if (payload.type !== "user_action") return;
    ui.log.push({
      kind: "user_action",
      requestId: payload.requestId,
      action: payload.action,
      reason: payload.reason,
    });
  },
  user_action_resolved: (ui, payload) => {
    if (payload.type !== "user_action_resolved") return;
    resolveUserActionItem(ui.log, payload.requestId, Boolean(payload.cancelled), payload.comment);
  },
  pending_edits: (ui, payload) => {
    if (payload.type !== "pending_edits") return;
    ui.pendingEdits = payload.paths;
  },
  todos: (ui, payload) => {
    if (payload.type !== "todos") return;
    ui.todos = payload.items;
  },
  debug_hypotheses: (ui, payload) => {
    if (payload.type !== "debug_hypotheses") return;
    ui.hypotheses = payload.hypotheses;
  },
  debug_log: (ui, payload) => {
    if (payload.type !== "debug_log") return;
    ui.debugLogCount = payload.count;
  },
};

function mirrorStatus(ui: RuntimeUiState, text: string): void {
  if (text === "Thinking…") {
    const last = ui.log[ui.log.length - 1];
    if (last?.kind === "status" && last.text === "Thinking…") return;
    if (last?.kind === "reasoning") return;
  }
  ui.log.push({ kind: "status", text });
}

function resolveApprovalItem(
  log: UiLogItem[],
  requestId: string,
  patch: Partial<Extract<UiLogItem, { kind: "approval" }>>,
): void {
  for (const item of log) {
    if (item.kind === "approval" && item.requestId === requestId) {
      Object.assign(item, patch);
    }
  }
}

function resolveQuestionItem(
  log: UiLogItem[],
  requestId: string,
  cancelled: boolean,
  answers?: Extract<UiLogItem, { kind: "question" }>["answers"],
): void {
  for (const item of log) {
    if (item.kind !== "question" || item.requestId !== requestId) continue;
    item.resolved = true;
    item.cancelled = cancelled;
    if (answers) item.answers = answers;
  }
}

function resolveUserActionItem(
  log: UiLogItem[],
  requestId: string,
  cancelled: boolean,
  comment?: string,
): void {
  for (const item of log) {
    if (item.kind !== "user_action" || item.requestId !== requestId) continue;
    item.resolved = true;
    item.cancelled = cancelled;
    if (comment) item.comment = comment;
  }
}

/** Apply an agent/UI event to a session's mirrored UI state (used for both live
 * streaming and reconstructing state when a session isn't the active one). */
export function mirrorEventIntoUi(ui: RuntimeUiState, payload: HostToWebview): void {
  HANDLERS[payload.type]?.(ui, payload);
}
