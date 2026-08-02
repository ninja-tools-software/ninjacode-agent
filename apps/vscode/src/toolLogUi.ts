import type { ToolEventPayload, ToolLogFields } from "./protocol.js";
import { mergeToolFields, toolPayloadToFields } from "./toolUi.js";

type ToolLogEntry = { kind: "tool" } & ToolLogFields;

function toolItemFromPayload(payload: Partial<ToolEventPayload>): ToolLogEntry {
  return { kind: "tool", ...toolPayloadToFields(payload) };
}

/**
 * Merge a `tool` event into the log: `tool_start` creates the card, `tool_end`
 * updates it in place. Events without an id are ignored.
 */
export function upsertToolInLog<T extends { kind: string; id?: string }>(
  log: T[],
  payload: Partial<ToolEventPayload>,
): T[] {
  if (!payload.id) return log;

  const idx = log.findIndex((item) => item.kind === "tool" && item.id === payload.id);
  if (idx === -1) {
    return [...log, toolItemFromPayload(payload) as unknown as T];
  }

  const prev = log[idx] as unknown as ToolLogEntry;
  const copy = [...log];
  copy[idx] = { kind: "tool", ...mergeToolFields(prev, payload) } as unknown as T;
  return copy;
}
