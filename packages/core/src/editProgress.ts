import type { Message } from "@ninjacode/providers";

/** Tools that change the workspace. Calling one is the agent's first real commitment. */
const MUTATING_TOOLS = new Set(["edit_file", "write_file", "apply_patch", "delete_file"]);

const PLAN_TOOLS = new Set(["write_plan"]);

/** Fractions of the turn budget at which an agent that has not edited is warned. */
const EDIT_NUDGE_AT = [0.5, 0.8];

/** Absolute turns so a 64-turn budget still warns before the agent has burned a long explore phase. */
const EDIT_NUDGE_AT_TURNS = [3, 6, 10];

/**
 * Fractions of the wall clock at which an agent that has not edited is warned.
 * Turn marks alone are blind to pace: a run whose turns cost minutes each can
 * burn its whole budget between two marks and only hear about it at 97%.
 */
const CLOCK_NUDGE_AT = [0.5, 0.75];

export type ProgressGoal = "edit" | "plan";

/** Observed cost of a turn plus what the run has left, when the run is timed. */
export interface ProgressClock {
  remainingMs: number;
  runTimeoutMs: number;
  recentTurnMs: readonly number[];
}

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
  clock?: ProgressClock;
  /** Set when a clock mark just tripped, so the warning fires off the turn marks. */
  clockMarkDue?: boolean;
}): string | undefined {
  if (opts.mutated || opts.maxTurns <= 0) return undefined;
  const goal = opts.goal ?? "edit";
  const onTurnMark = nudgeTurns(opts.maxTurns, goal).includes(opts.turn);
  if (!onTurnMark && !opts.clockMarkDue) return undefined;

  const spent = spentBudget(opts.turn, opts.maxTurns, opts.clock);
  const action =
    goal === "plan"
      ? "Write the plan now with current evidence via write_plan (and todo_write in the same turn). " +
        "Do not keep reconfirming a hypothesis you already have; more exploration is not progress."
      : "Stop investigating and apply your best current hypothesis as an edit now: " +
        `a wrong edit you can then verify and fix beats ${spent.ranOut} with nothing to show.`;
  const missing = goal === "plan" ? "no plan has been written yet" : "no file has been changed yet";
  return `${spent.headline} and ${missing} — only reads and searches so far. ${spent.remaining} ${action}`;
}

/**
 * Names whichever budget is closer to exhausted. Reporting turns while the clock
 * is the binding constraint is worse than saying nothing: it tells an agent with
 * seconds left that it has dozens of turns to spend.
 */
function spentBudget(
  turn: number,
  maxTurns: number,
  clock: ProgressClock | undefined,
): { headline: string; remaining: string; ranOut: string } {
  const turnsRemaining = maxTurns - turn;
  const turnBudget = {
    headline: `${turn} of ${maxTurns} turns are gone`,
    remaining: `${turnsRemaining} turns remain.`,
    ranOut: "running out of turns",
  };
  if (!clock || clock.runTimeoutMs <= 0 || !Number.isFinite(clock.remainingMs)) return turnBudget;

  const clockFraction = 1 - Math.max(0, clock.remainingMs) / clock.runTimeoutMs;
  if (clockFraction <= turn / maxTurns) return turnBudget;
  return {
    headline: `${percent(clockFraction)} of the run's time is gone`,
    remaining: `${humanMs(clock.remainingMs)} remain${turnPace(clock.recentTurnMs)}.`,
    ranOut: "running out of time",
  };
}

/** A turn's cost is invisible to the model, and it is what makes the budget real. */
function turnPace(recentTurnMs: readonly number[]): string {
  const samples = recentTurnMs.filter((value) => Number.isFinite(value) && value > 0);
  if (samples.length === 0) return "";
  const slowest = Math.max(...samples);
  return `, and your recent turns took up to ${humanMs(slowest)} each`;
}

function percent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

function humanMs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 90) return `${seconds}s`;
  return `${Math.round(seconds / 60)}min`;
}

/**
 * Returns the clock mark this run has just crossed, or `undefined`. The caller
 * owns `fired` so each mark yields exactly one message and this stays pure.
 */
export function dueClockMark(
  clock: ProgressClock | undefined,
  fired: readonly number[],
): number | undefined {
  if (!clock || clock.runTimeoutMs <= 0 || !Number.isFinite(clock.remainingMs)) return undefined;
  const elapsedFraction = 1 - Math.max(0, clock.remainingMs) / clock.runTimeoutMs;
  // Only the furthest mark crossed matters: a run that jumps from 10% to 97% in
  // one turn needs one urgent warning, not one per mark it skipped over.
  const highestFired = fired.length > 0 ? Math.max(...fired) : 0;
  return CLOCK_NUDGE_AT.filter((mark) => elapsedFraction >= mark && mark > highestFired).pop();
}
