import type { LogItem } from "../types.js";

/** Index of the last `write_plan` tool card in the log, or -1. */
export function lastWritePlanIndex(log: LogItem[]): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const item = log[i];
    if (item?.kind === "tool" && item.name === "write_plan") return i;
  }
  return -1;
}

/** Whether the conversation log contains at least one completed plan write. */
export function hasWritePlanInLog(log: LogItem[]): boolean {
  return lastWritePlanIndex(log) >= 0;
}

/** Upper bound (exclusive) of the plan block anchored at `writePlanIndex`. */
function planBlockEnd(log: LogItem[], writePlanIndex: number): number {
  for (let i = writePlanIndex + 1; i < log.length; i++) {
    if (log[i]?.kind === "user") return i;
  }
  return log.length;
}

/**
 * Assistant messages after the final `write_plan` in the current plan block.
 * These are shown before the plan card (log order is write_plan → todo_write → summary).
 */
export function planBlockSummaryIndices(log: LogItem[], writePlanIndex: number): number[] {
  if (writePlanIndex < 0) return [];
  const end = planBlockEnd(log, writePlanIndex);
  const indices: number[] = [];
  for (let i = writePlanIndex + 1; i < end; i++) {
    if (log[i]?.kind === "assistant") indices.push(i);
  }
  return indices;
}

/** Last `todo_write` in the plan block after `writePlanIndex`, or -1. */
export function planBlockTodoWriteIndex(log: LogItem[], writePlanIndex: number): number {
  if (writePlanIndex < 0) return -1;
  const end = planBlockEnd(log, writePlanIndex);
  let last = -1;
  for (let i = writePlanIndex + 1; i < end; i++) {
    const item = log[i];
    if (item?.kind === "tool" && item.name === "todo_write") last = i;
  }
  return last;
}
