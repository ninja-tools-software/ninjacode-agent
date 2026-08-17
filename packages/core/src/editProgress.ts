import type { Message } from "@ninjacode/providers";

/** Tools that change the workspace. Calling one is the agent's first real commitment. */
const MUTATING_TOOLS = new Set(["edit_file", "write_file", "apply_patch", "delete_file"]);

const PLAN_TOOLS = new Set(["write_plan"]);

/** Fractions of the turn budget at which an agent that has not edited is warned. */
const EDIT_NUDGE_AT = [0.5, 0.8];

/** Absolute turns so a 64-turn budget still warns before the agent has burned a long explore phase. */
const EDIT_NUDGE_AT_TURNS = [3, 6, 10];

export type ProgressGoal = "edit" | "plan";

export function hasMutatedWorkspace(history: Message[]): boolean {
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (message?.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (!MUTATING_TOOLS.has(call.name)) continue;
      const result = history
        .slice(index + 1)
        .find((entry) => entry.role === "tool" && entry.toolCallId === call.id);
      if (result && !looksLikeFailedToolResult(result.content)) return true;
    }
  }
  return false;
}

function looksLikeFailedToolResult(content: string): boolean {
  return /^(?:error|failed|denied)|tool error \[|permission denied/iu.test(content.trim());
}

export function hasWrittenPlan(history: Message[]): boolean {
  return history.some(
    (m) => m.role === "assistant" && (m.toolCalls ?? []).some((tc) => PLAN_TOOLS.has(tc.name)),
  );
}

function nudgeTurns(maxTurns: number, goal: ProgressGoal): number[] {
  if (goal === "plan") {
    const early = Math.min(8, Math.max(3, Math.floor(maxTurns * 0.125)));
    const late = Math.max(early + 1, Math.floor(maxTurns * 0.4));
    return uniqueSorted([early, late]);
  }
  const fractionMarks = EDIT_NUDGE_AT.map((fraction) => Math.floor(maxTurns * fraction));
  const absoluteMarks = EDIT_NUDGE_AT_TURNS.filter((turn) => turn < maxTurns);
  return uniqueSorted([...absoluteMarks, ...fractionMarks]);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter((turn) => turn > 0))].sort((a, b) => a - b);
}

/**
 * Benchmarks show the dominant failure is not a wrong edit, it is no edit at all:
 * the agent reads and greps until the turn budget is gone. Exploration has no
 * natural stopping point, so the budget has to supply one — twice, then never
 * again, because a warning repeated every turn is noise the model learns to skip.
 *
 * In PLAN mode the equivalent commitment is write_plan, and the first nudge
 * fires around 8 turns so a session cannot "reconfirm" for 25 turns after the
 * root cause is already known.
 *
 * Returns the message to inject, or undefined when there is nothing to say.
 * `turn` is 1-based; firing on exact marks is what keeps this to one message each.
 */
export function editProgressWarning(opts: {
  turn: number;
  maxTurns: number;
  mutated: boolean;
  goal?: ProgressGoal;
}): string | undefined {
  if (opts.mutated || opts.maxTurns <= 0) return undefined;
  const goal = opts.goal ?? "edit";
  const marks = nudgeTurns(opts.maxTurns, goal);
  if (!marks.includes(opts.turn)) return undefined;

  const remaining = opts.maxTurns - opts.turn;
  if (goal === "plan") {
    return (
      `${opts.turn} of ${opts.maxTurns} turns are gone and no plan has been written yet — ` +
      `only reads and searches so far. ${remaining} turns remain. ` +
      "Write the plan now with current evidence via write_plan (and todo_write in the same turn). " +
      "Do not keep reconfirming a hypothesis you already have; more exploration is not progress."
    );
  }
  return (
    `${opts.turn} of ${opts.maxTurns} turns are gone and no file has been changed yet — ` +
    `only reads and searches so far. ${remaining} turns remain. ` +
    "Stop investigating and apply your best current hypothesis as an edit now: " +
    "a wrong edit you can then verify and fix beats running out of turns with nothing to show."
  );
}
