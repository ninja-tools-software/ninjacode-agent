/**
 * All conversation state, derived from host messages by one pure reducer.
 */
import type { LogItem } from "../types.js";
import { reduceClear, reducePanelMessage, reducePlanMessage, reduceSessionMessage } from "./chatReducerPanels.js";
import { reduceHydrate, reduceLogMessage } from "./chatReducerLog.js";
import {
  initialChatState,
  type ChatAction,
  type ChatState,
} from "./chatReducerTypes.js";

export type { ChatAction, ChatState } from "./chatReducerTypes.js";
export { initialChatState } from "./chatReducerTypes.js";

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.kind === "sessions_loading") return { ...state, sessionsLoading: action.loading };
  if (action.kind === "clear_plan") return { ...state, plan: null };
  if (action.kind === "dismiss_drag_tip") return { ...state, showDragTip: false };
  if (action.kind === "dismiss_onboarding") return { ...state, onboardingDismissed: true };

  const msg = action.message;
  if (msg.type === "hydrate") return reduceHydrate(state, msg);
  if (msg.type === "reset_onboarding") return { ...state, onboardingDismissed: false };
  if (msg.type === "clear") return reduceClear(state, initialChatState);

  return (
    reduceLogMessage(state, msg) ??
    reduceSessionMessage(state, msg) ??
    reducePlanMessage(state, msg) ??
    reducePanelMessage(state, msg) ??
    state
  );
}

/** Index of the last log entry of a given kind, or -1. */
export function lastIndexOfKind(log: LogItem[], kind: LogItem["kind"]): number {
  for (let i = log.length - 1; i >= 0; i--) if (log[i]?.kind === kind) return i;
  return -1;
}

/** The status line of the current turn, while it is still the newest activity. */
export function liveIndex(
  log: LogItem[],
  kind: "status" | "reasoning",
  lastUserIndex: number,
  active: boolean,
): number {
  if (!active) return -1;
  let found = -1;
  for (let i = lastUserIndex + 1; i < log.length; i++) if (log[i]?.kind === kind) found = i;
  if (found === -1) return -1;
  const supersedes: LogItem["kind"][] =
    kind === "status" ? ["assistant", "tool", "reasoning"] : ["assistant", "tool"];
  for (let i = found + 1; i < log.length; i++) {
    if (supersedes.includes(log[i]!.kind)) return -1;
  }
  return found;
}
