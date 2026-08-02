import type { ChatState } from "./chatReducerTypes.js";
import type { HostToWebview, LogItem } from "../types.js";

function resolveCard(
  log: LogItem[],
  kind: "approval" | "question" | "user_action",
  requestId: string,
  patch: Partial<LogItem>,
): LogItem[] {
  return log.map((item) =>
    item.kind === kind && "requestId" in item && item.requestId === requestId
      ? ({ ...item, ...patch } as LogItem)
      : item,
  );
}

export function reduceInteractionMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  switch (msg.type) {
    case "approval":
      return {
        ...state,
        log: [
          ...state.log,
          {
            kind: "approval",
            requestId: msg.requestId,
            toolName: msg.toolName,
            target: msg.target,
            reason: msg.reason,
            grantScope: msg.grantScope,
          },
        ],
      };
    case "approval_resolved":
      return {
        ...state,
        log: resolveCard(state.log, "approval", msg.requestId, {
          resolved: true,
          approved: msg.approved,
          cancelled: Boolean(msg.cancelled),
          remember: msg.remember,
        }),
      };
    case "question":
      return {
        ...state,
        log: [...state.log, { kind: "question", requestId: msg.requestId, questions: msg.questions ?? [] }],
      };
    case "question_resolved":
      return {
        ...state,
        log: resolveCard(state.log, "question", msg.requestId, {
          resolved: true,
          cancelled: Boolean(msg.cancelled),
          ...(msg.answers ? { answers: msg.answers } : {}),
        } as Partial<LogItem>),
      };
    case "user_action":
      return {
        ...state,
        log: [
          ...state.log,
          { kind: "user_action", requestId: msg.requestId, action: msg.action, reason: msg.reason },
        ],
      };
    case "user_action_resolved":
      return {
        ...state,
        log: resolveCard(state.log, "user_action", msg.requestId, {
          resolved: true,
          cancelled: Boolean(msg.cancelled),
          ...(msg.comment ? { comment: msg.comment } : {}),
        } as Partial<LogItem>),
      };
    default:
      return null;
  }
}
