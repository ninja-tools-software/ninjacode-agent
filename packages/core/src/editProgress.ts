import type { Message } from "@ninjacode/providers";

/** Tools that change the workspace. Calling one is the agent's first real commitment. */
const MUTATING_TOOLS = new Set(["edit_file", "write_file", "apply_patch", "delete_file"]);

/** Fractions of the turn budget at which an agent that has not edited is warned. */
const NUDGE_AT = [0.5, 0.8];

export function hasMutatedWorkspace(history: Message[]): boolean {
  return history.some(
    (m) => m.role === "assistant" && (m.toolCalls ?? []).some((tc) => MUTATING_TOOLS.has(tc.name)),
  );
}

/**
 * Benchmarks show the dominant failure is not a wrong edit, it is no edit at all:
 * the agent reads and greps until the turn budget is gone. Exploration has no
 * natural stopping point, so the budget has to supply one — twice, then never
 * again, because a warning repeated every turn is noise the model learns to skip.
 *
 * Returns the message to inject, or undefined when there is nothing to say.
 * `turn` is 1-based; firing on exact marks is what keeps this to one message each.
 */
export function editProgressWarning(opts: {
  turn: number;
  maxTurns: number;
  mutated: boolean;
}): string | undefined {
  if (opts.mutated || opts.maxTurns <= 0) return undefined;
  const marks = NUDGE_AT.map((fraction) => Math.floor(opts.maxTurns * fraction));
  if (!marks.includes(opts.turn)) return undefined;

  const remaining = opts.maxTurns - opts.turn;
  return (
    `${opts.turn} of ${opts.maxTurns} turns are gone and no file has been changed yet — ` +
    `only reads and searches so far. ${remaining} turns remain. ` +
    "Stop investigating and apply your best current hypothesis as an edit now: " +
    "a wrong edit you can then verify and fix beats running out of turns with nothing to show."
  );
}
