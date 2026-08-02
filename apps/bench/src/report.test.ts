import { describe, expect, it } from "vitest";
import { computePassAtK } from "./report.js";
import type { TaskResult } from "./types.js";

function result(taskId: string, trial: number, passed: boolean): TaskResult {
  return {
    taskId,
    agentName: "test",
    trial,
    passed,
    metrics: {
      wallTimeMs: 1,
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    },
    outputTail: "",
  };
}

describe("computePassAtK", () => {
  it("computes pass@k across tasks", () => {
    const stats = computePassAtK([
      result("a", 1, true),
      result("a", 2, false),
      result("b", 1, false),
      result("b", 2, false),
    ]);
    expect(stats.passAtK).toBe(0.5);
  });
});
