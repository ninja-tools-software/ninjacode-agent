import { describe, expect, it } from "vitest";
import type { LogItem } from "../types.js";
import {
  hasWritePlanInLog,
  lastWritePlanIndex,
  planBlockSummaryIndices,
  planBlockTodoWriteIndex,
} from "./planCardMarks.js";

function tool(name: string, id: string): LogItem {
  return {
    kind: "tool",
    id,
    name,
    label: name,
    status: "done",
  };
}

describe("planCardMarks", () => {
  it("returns -1 when no write_plan tool exists", () => {
    const log: LogItem[] = [{ kind: "assistant", text: "hi" }, tool("read_file", "1")];
    expect(lastWritePlanIndex(log)).toBe(-1);
    expect(hasWritePlanInLog(log)).toBe(false);
  });

  it("finds the last write_plan entry", () => {
    const log: LogItem[] = [
      tool("write_plan", "a"),
      { kind: "assistant", text: "done" },
      tool("write_plan", "b"),
    ];
    expect(lastWritePlanIndex(log)).toBe(2);
    expect(hasWritePlanInLog(log)).toBe(true);
  });

  it("collects assistant summaries after write_plan until the next user turn", () => {
    const log: LogItem[] = [
      { kind: "assistant", text: "intro" },
      tool("write_plan", "a"),
      tool("todo_write", "t"),
      { kind: "assistant", text: "summary" },
      { kind: "user", text: "next" },
      { kind: "assistant", text: "later" },
    ];
    const wp = lastWritePlanIndex(log);
    expect(planBlockSummaryIndices(log, wp)).toEqual([3]);
    expect(planBlockTodoWriteIndex(log, wp)).toBe(2);
  });
});
