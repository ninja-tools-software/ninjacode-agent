import { appendReasoningToLog } from "../../../../src/reasoningUi.js";
import { upsertToolInLog } from "../../../../src/toolLogUi.js";
import type { ChatState } from "./chatReducerTypes.js";
import type { HostToWebview, LogItem } from "../types.js";

function appendAssistant(log: LogItem[], text: string): LogItem[] {
  const last = log[log.length - 1];
  if (last?.kind === "assistant") {
    const copy = [...log];
    copy[copy.length - 1] = { kind: "assistant", text: last.text + text };
    return copy;
  }
  return [...log, { kind: "assistant", text }];
}

function appendStatus(log: LogItem[], text: string): LogItem[] {
  if (text !== "Thinking…") return [...log, { kind: "status", text }];
  const last = log[log.length - 1];
  if (last?.kind === "status" && last.text === "Thinking…") return log;
  if (last?.kind === "reasoning") return log;
  return [...log, { kind: "status", text }];
}

export function reduceStreamMessage(state: ChatState, msg: HostToWebview): ChatState | null {
  switch (msg.type) {
    case "user":
      return { ...state, log: [...state.log, { kind: "user", text: msg.text, refs: msg.refs }] };
    case "assistant_delta":
      return msg.text ? { ...state, log: appendAssistant(state.log, msg.text) } : state;
    case "reasoning_delta":
      return msg.text
        ? { ...state, log: appendReasoningToLog(state.log, msg.text) as LogItem[] }
        : state;
    case "tool":
      return { ...state, log: upsertToolInLog(state.log, msg) };
    case "status":
      return { ...state, log: appendStatus(state.log, msg.text ?? "") };
    case "routing":
      return {
        ...state,
        log: [
          ...state.log,
          {
            kind: "routing",
            model: msg.model,
            label: msg.label,
            reason: msg.reason,
            tier: msg.tier,
            estimatedCredits: msg.estimatedCredits,
          },
        ],
        sessionUsage: state.sessionUsage
          ? { ...state.sessionUsage, resolvedModel: msg.model }
          : state.sessionUsage,
      };
    case "error":
      return { ...state, log: [...state.log, { kind: "error", text: msg.text }] };
    case "gateway_error":
      return {
        ...state,
        log: [...state.log, { kind: "gateway_error", ...msg.info }],
      };
    default:
      return null;
  }
}
