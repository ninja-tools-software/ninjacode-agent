import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import {
  dueClockMark,
  editProgressWarning,
  hasMutatedWorkspace,
  hasWrittenPlan,
} from "./editProgress.js";

function assistant(...tools: string[]): Message {
  return {
    role: "assistant",
    content: "",
    toolCalls: tools.map((name, i) => ({ id: `c${i}`, name, arguments: {} })),
  };
}

describe("hasMutatedWorkspace", () => {
  it("is false while the agent only reads and searches", () => {
    const history = [assistant("read_file", "grep"), assistant("list_dir"), assistant("run_shell")];
    expect(hasMutatedWorkspace(history)).toBe(false);
  });

  it("is true only after a mutating tool result succeeds", () => {
    expect(hasMutatedWorkspace([assistant("write_file")])).toBe(false);
    expect(
      hasMutatedWorkspace([
        assistant("write_file"),
        { role: "tool", toolCallId: "c0", content: "Error: permission denied" },
      ]),
    ).toBe(false);
    expect(hasMutatedWorkspace([assistant("read_file"), assistant("apply_patch")])).toBe(false);
    expect(
      hasMutatedWorkspace([
        assistant("apply_patch"),
        { role: "tool", toolCallId: "c0", content: "Applied patch to src/a.ts" },
      ]),
    ).toBe(true);
    expect(
      hasMutatedWorkspace([
        assistant("edit_file"),
        { role: "tool", toolCallId: "c0", content: "Updated src/a.ts" },
      ]),
    ).toBe(true);
    expect(
      hasMutatedWorkspace([
        assistant("write_file"),
        { role: "tool", toolCallId: "c0", content: "Wrote 12 bytes to image.c" },
      ]),
    ).toBe(true);
  });

  it("ignores tool result messages", () => {
    const history: Message[] = [{ role: "tool", content: "edit_file", toolCallId: "c0" }];
    expect(hasMutatedWorkspace(history)).toBe(false);
  });
});

describe("editProgressWarning", () => {
  it("stays silent once an edit has landed", () => {
    expect(editProgressWarning({ turn: 25, maxTurns: 50, mutated: true })).toBeUndefined();
  });

  it("fires at early absolute marks and at half and four fifths of the budget", () => {
    expect(editProgressWarning({ turn: 3, maxTurns: 50, mutated: false })).toMatch(/3 of 50/);
    expect(editProgressWarning({ turn: 6, maxTurns: 50, mutated: false })).toMatch(/6 of 50/);
    expect(editProgressWarning({ turn: 10, maxTurns: 50, mutated: false })).toMatch(/10 of 50/);
    expect(editProgressWarning({ turn: 25, maxTurns: 50, mutated: false })).toMatch(/25 of 50/);
    expect(editProgressWarning({ turn: 40, maxTurns: 50, mutated: false })).toMatch(/40 of 50/);
  });

  it("fires only on those turns, so the model does not learn to skip it", () => {
    const fired = [];
    for (let turn = 1; turn <= 50; turn++) {
      if (editProgressWarning({ turn, maxTurns: 50, mutated: false })) fired.push(turn);
    }
    expect(fired).toEqual([3, 6, 10, 25, 40]);
  });

  it("reports the remaining budget so the agent can size its next move", () => {
    expect(editProgressWarning({ turn: 25, maxTurns: 50, mutated: false })).toContain(
      "25 turns remain",
    );
  });

  /**
   * The canary sent "58 turns remain" with 28s of wall clock left. Reporting the
   * budget that is not binding tells the agent it can keep exploring.
   */
  it("names the clock, not the turns, once the clock is the scarce budget", () => {
    const message = editProgressWarning({
      turn: 6,
      maxTurns: 64,
      mutated: false,
      clock: { remainingMs: 28_000, runTimeoutMs: 840_000, recentTurnMs: [206_100, 390_400] },
      clockMarkDue: true,
    });

    expect(message).toContain("97% of the run's time is gone");
    expect(message).toContain("28s remain");
    expect(message).toContain("running out of time");
    expect(message).not.toContain("turns remain");
    expect(message).not.toContain("running out of turns");
  });

  /** A turn's cost is the budget figure the model cannot observe for itself. */
  it("quotes the observed cost of a turn, and omits it when unmeasured", () => {
    const clock = { remainingMs: 419_000, runTimeoutMs: 840_000, recentTurnMs: [203_900, 206_100] };

    expect(editProgressWarning({ turn: 5, maxTurns: 64, mutated: false, clock, clockMarkDue: true }))
      .toContain("recent turns took up to 3min each");
    expect(
      editProgressWarning({
        turn: 5,
        maxTurns: 64,
        mutated: false,
        clock: { ...clock, recentTurnMs: [] },
        clockMarkDue: true,
      }),
    ).not.toContain("recent turns");
  });

  it("keeps the turn wording while turns are the scarce budget", () => {
    const message = editProgressWarning({
      turn: 40,
      maxTurns: 50,
      mutated: false,
      clock: { remainingMs: 800_000, runTimeoutMs: 840_000, recentTurnMs: [1_000] },
    });

    expect(message).toContain("40 of 50 turns are gone");
    expect(message).toContain("10 turns remain");
  });

  it("stays on turns for an untimed run", () => {
    expect(
      editProgressWarning({
        turn: 3,
        maxTurns: 64,
        mutated: false,
        clock: { remainingMs: Number.POSITIVE_INFINITY, runTimeoutMs: 0, recentTurnMs: [] },
      }),
    ).toContain("61 turns remain");
  });

  it("treats write_plan as progress in plan mode and nudges earlier", () => {
    expect(hasWrittenPlan([assistant("write_plan")])).toBe(true);
    expect(editProgressWarning({ turn: 8, maxTurns: 64, mutated: false, goal: "plan" })).toMatch(
      /no plan has been written/,
    );
    expect(editProgressWarning({ turn: 25, maxTurns: 64, mutated: false, goal: "plan" })).toMatch(
      /write_plan/,
    );
    expect(editProgressWarning({ turn: 8, maxTurns: 64, mutated: true, goal: "plan" })).toBeUndefined();
    expect(editProgressWarning({ turn: 32, maxTurns: 64, mutated: false, goal: "plan" })).toBeUndefined();
  });
});

describe("dueClockMark", () => {
  const clockAt = (elapsedFraction: number) => ({
    remainingMs: 840_000 * (1 - elapsedFraction),
    runTimeoutMs: 840_000,
    recentTurnMs: [],
  });

  it("stays silent while the run has spent less than half its clock", () => {
    expect(dueClockMark(clockAt(0.49), [])).toBeUndefined();
  });

  it("yields each mark once, so the model does not learn to skip it", () => {
    const fired: number[] = [];
    for (const elapsed of [0.5, 0.6, 0.75, 0.9]) {
      const mark = dueClockMark(clockAt(elapsed), fired);
      if (mark !== undefined) fired.push(mark);
    }
    expect(fired).toEqual([0.5, 0.75]);
  });

  /** A turn costing minutes can skip a mark entirely; one urgent warning suffices. */
  it("reports only the furthest mark when a single turn skips over several", () => {
    expect(dueClockMark(clockAt(0.97), [])).toBe(0.75);
    expect(dueClockMark(clockAt(0.97), [0.75])).toBeUndefined();
  });

  it("has nothing to say about an untimed run", () => {
    expect(
      dueClockMark({ remainingMs: Number.POSITIVE_INFINITY, runTimeoutMs: 0, recentTurnMs: [] }, []),
    ).toBeUndefined();
  });
});
