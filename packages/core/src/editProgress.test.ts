import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import { editProgressWarning, hasMutatedWorkspace, hasWrittenPlan } from "./editProgress.js";

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
