import { describe, expect, it } from "vitest";
import type { LogItem } from "../types.js";
import { explorationGroups } from "./explorationGroups.js";

function tool(name: string, id: string): LogItem {
  return { kind: "tool", id, name, label: name, status: "done" };
}

describe("explorationGroups", () => {
  it("groups consecutive exploration tools", () => {
    const log: LogItem[] = [
      { kind: "user", text: "go" },
      tool("read_file", "a"),
      tool("grep", "b"),
      tool("glob", "c"),
    ];
    const marks = explorationGroups(log);
    expect(marks.heads.get(1)?.tools).toEqual([1, 2, 3]);
    expect([...marks.members]).toEqual([2, 3]);
  });

  it("leaves a lone exploration tool as a plain card", () => {
    const log: LogItem[] = [tool("read_file", "a"), { kind: "assistant", text: "done" }];
    const marks = explorationGroups(log);
    expect(marks.heads.size).toBe(0);
    expect(marks.members.size).toBe(0);
  });

  it("ends a run on a non-exploration tool", () => {
    const log: LogItem[] = [
      tool("read_file", "a"),
      tool("grep", "b"),
      tool("edit_file", "c"),
      tool("read_file", "d"),
      tool("list_dir", "e"),
    ];
    const marks = explorationGroups(log);
    expect([...marks.heads.keys()]).toEqual([0, 3]);
    expect(marks.heads.get(0)?.tools).toEqual([0, 1]);
    expect(marks.heads.get(3)?.tools).toEqual([3, 4]);
  });

  it("ends a run on assistant text and reasoning", () => {
    const log: LogItem[] = [
      tool("read_file", "a"),
      tool("grep", "b"),
      { kind: "reasoning", text: "hmm" },
      tool("read_file", "c"),
      { kind: "assistant", text: "hi" },
      tool("glob", "d"),
    ];
    const marks = explorationGroups(log);
    expect([...marks.heads.keys()]).toEqual([0]);
    expect(marks.heads.get(0)?.tools).toEqual([0, 1]);
  });

  it("absorbs status lines between two exploration tools", () => {
    const log: LogItem[] = [
      tool("read_file", "a"),
      { kind: "status", text: "Thinking…" },
      tool("grep", "b"),
    ];
    const marks = explorationGroups(log);
    expect(marks.heads.get(0)?.tools).toEqual([0, 2]);
    expect(marks.members.has(1)).toBe(true);
  });

  it("keeps a trailing status line outside the group", () => {
    const log: LogItem[] = [
      tool("read_file", "a"),
      tool("grep", "b"),
      { kind: "status", text: "Thinking…" },
    ];
    const marks = explorationGroups(log);
    expect(marks.heads.get(0)?.tools).toEqual([0, 1]);
    expect(marks.members.has(2)).toBe(false);
  });

  it("does not group unknown tools such as MCP calls", () => {
    const log: LogItem[] = [tool("mcp__server__query", "a"), tool("mcp__server__query", "b")];
    expect(explorationGroups(log).heads.size).toBe(0);
  });
});
