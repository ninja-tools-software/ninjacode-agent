import type { ChatState } from "./chatReducerTypes.js";
import { initialChatState } from "./chatReducerTypes.js";
import type { HostToWebview, TodoItem, TodoStatus } from "../types.js";

function asTodos(items: Array<{ id: string; content: string; status: string }>): TodoItem[] {
  return items.map((t) => ({ id: t.id, content: t.content, status: t.status as TodoStatus }));
}

export function reduceSessionMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  switch (msg.type) {
    case "sessions":
      return { ...state, sessions: msg.sessions ?? [], activeSessionId: msg.activeSessionId };
    case "session_changed":
      return { ...state, activeSessionId: msg.activeSessionId };
    case "sessions_loading":
      return { ...state, sessionsLoading: Boolean(msg.loading) };
    case "run_state":
      return { ...state, runState: msg.state ?? "idle" };
    case "queue":
      return { ...state, queue: msg.queue ?? [] };
    case "context_usage": {
      const { type: _type, ...usage } = msg;
      return { ...state, contextUsage: usage };
    }
    case "usage": {
      const { type: _type, ...usage } = msg;
      return { ...state, sessionUsage: usage };
    }
    default:
      return null;
  }
}

export function reducePlanMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  switch (msg.type) {
    case "plan":
      return {
        ...state,
        plan: { id: msg.planId, title: msg.title, path: msg.path, content: msg.content },
      };
    case "plan_clear":
      return { ...state, plan: null };
    case "plans":
      return { ...state, plans: msg.items ?? [] };
    default:
      return null;
  }
}

export function reducePanelMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  switch (msg.type) {
    case "pending_edits":
      return { ...state, pendingEdits: msg.paths ?? [] };
    case "todos":
      return { ...state, todos: asTodos(msg.items ?? []) };
    case "changes":
      return { ...state, changes: msg.changes ?? [] };
    case "hunks":
      return { ...state, hunksByPath: { ...state.hunksByPath, [msg.path]: msg.hunks ?? [] } };
    case "auto_accept":
      return { ...state, autoAcceptDeadline: typeof msg.deadline === "number" ? msg.deadline : null };
    case "debug_hypotheses":
      return { ...state, hypotheses: msg.hypotheses ?? [] };
    case "debug_log":
      return { ...state, debugLogCount: msg.count ?? 0 };
    default:
      return null;
  }
}

export function reduceClear(state: ChatState, initial: typeof initialChatState): ChatState {
  return {
    ...initial,
    sessions: state.sessions,
    sessionsLoading: state.sessionsLoading,
    showDragTip: state.showDragTip,
    onboardingDismissed: state.onboardingDismissed,
  };
}
