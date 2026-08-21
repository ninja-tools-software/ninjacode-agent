import { isExplorationTool } from "../../../../src/toolUi.js";
import type { LogItem } from "../types.js";

/** A run of consecutive information-gathering tool calls, rendered as one collapsible node. */
export interface ExplorationGroup {
  /** Log index of the first tool of the run; the group renders in its place. */
  head: number;
  /** Log indices of the tool cards in the run, in order. */
  tools: number[];
}

export interface ExplorationMarks {
  /** Head index → group. */
  heads: Map<number, ExplorationGroup>;
  /** Indices folded into a group, hidden at top level. Includes absorbed status lines. */
  members: Set<number>;
}

/** Below this, a group costs more attention than the cards it replaces. */
const MIN_GROUP_SIZE = 2;

function isExplorationEntry(item: LogItem | undefined): boolean {
  return item?.kind === "tool" && isExplorationTool(item.name);
}

/**
 * Per-turn "Thinking…" lines do not end a run: absorbing them lets one group span
 * several LLM turns, which is where the noise actually is.
 */
function isTransparentEntry(item: LogItem | undefined): boolean {
  return item?.kind === "status";
}

function commitGroup(marks: ExplorationMarks, tools: number[], absorbed: number[]): void {
  if (tools.length < MIN_GROUP_SIZE) return;
  const head = tools[0] as number;
  marks.heads.set(head, { head, tools });
  for (const index of tools.slice(1)) marks.members.add(index);
  for (const index of absorbed) marks.members.add(index);
}

/** Fold consecutive exploration tool calls into collapsible groups. */
export function explorationGroups(log: LogItem[]): ExplorationMarks {
  const marks: ExplorationMarks = { heads: new Map(), members: new Set() };
  let tools: number[] = [];
  let absorbed: number[] = [];
  let pending: number[] = [];

  for (let i = 0; i < log.length; i++) {
    const item = log[i];
    if (isExplorationEntry(item)) {
      // Transparent entries only count as absorbed once the run resumes after them.
      absorbed.push(...pending);
      pending = [];
      tools.push(i);
      continue;
    }
    if (isTransparentEntry(item) && tools.length > 0) {
      pending.push(i);
      continue;
    }
    commitGroup(marks, tools, absorbed);
    tools = [];
    absorbed = [];
    pending = [];
  }
  commitGroup(marks, tools, absorbed);
  return marks;
}
