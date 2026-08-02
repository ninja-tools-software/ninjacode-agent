import { normalizeReasoningLog } from "../../../../src/reasoningUi.js";
import { coerceLogItem } from "../log/toolLog.js";
import type { ChatState } from "./chatReducerTypes.js";
import type { HostToWebview, LogItem } from "../types.js";
import { reduceInteractionMessage } from "./chatReducerInteraction.js";
import { reduceStreamMessage } from "./chatReducerStream.js";

export function reduceHydrate(state: ChatState, msg: Extract<HostToWebview, { type: "hydrate" }>): ChatState {
  return {
    ...state,
    log: normalizeReasoningLog(msg.log.map(coerceLogItem) as LogItem[]),
    todos: msg.todos?.map((t) => ({ id: t.id, content: t.content, status: t.status as ChatState["todos"][0]["status"] })) ?? [],
    pendingEdits: msg.pendingEdits ?? [],
    hypotheses: msg.hypotheses ?? [],
    debugLogCount: msg.debugLogCount ?? 0,
    sessions: msg.sessions ?? state.sessions,
    activeSessionId: msg.activeSessionId,
    contextUsage: msg.contextUsage ?? null,
    sessionUsage: msg.sessionUsage ?? null,
    runState: msg.runState ?? "idle",
    queue: msg.queue ?? [],
    plan: null,
    showDragTip: msg.showDragTip ?? false,
  };
}

export function reduceLogMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  return reduceStreamMessage(state, msg) ?? reduceInteractionMessage(state, msg);
}
