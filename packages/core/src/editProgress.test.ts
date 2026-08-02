import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import { editProgressWarning, hasMutatedWorkspace } from "./editProgress.js";

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

  it("is true once any write tool is called", () => {
    expect(hasMutatedWorkspace([assistant("read_file"), assistant("apply_patch")])).toBe(true);
    expect(hasMutatedWorkspace([assistant("edit_file")])).toBe(true);
    expect(hasMutatedWorkspace([assistant("write_file")])).toBe(true);
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

  it("fires at half and at four fifths of the budget", () => {
    expect(editProgressWarning({ turn: 25, maxTurns: 50, mutated: false })).toMatch(/25 of 50/);
    expect(editProgressWarning({ turn: 40, maxTurns: 50, mutated: false })).toMatch(/40 of 50/);
  });

  it("fires only on those turns, so the model does not learn to skip it", () => {
    const fired = [];
    for (let turn = 1; turn <= 50; turn++) {
      if (editProgressWarning({ turn, maxTurns: 50, mutated: false })) fired.push(turn);
    }
    expect(fired).toEqual([25, 40]);
  });

  it("reports the remaining budget so the agent can size its next move", () => {
    expect(editProgressWarning({ turn: 25, maxTurns: 50, mutated: false })).toContain(
      "25 turns remain",
    );
  });
});
