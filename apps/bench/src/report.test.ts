import { describe, expect, it } from "vitest";
import { buildTrajectoryPairs, computePassAtK, computeTrialStatistics } from "./report.js";
import type { RunReport, TaskResult } from "./types.js";

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

  it("computes explicit three-trial reliability statistics", () => {
    const stats = computeTrialStatistics([
      result("a", 1, true),
      result("a", 2, false),
      result("a", 3, false),
      result("b", 1, true),
      result("b", 2, true),
      result("b", 3, true),
    ]);
    expect(stats.passAt3).toBe(1);
    expect(stats.passPow3).toBe(0.5);
    expect(stats.interTrialVariance).toBeGreaterThan(0);
    expect(stats.confidence95.lower).toBeLessThan(stats.confidence95.upper);
  });

  it("builds actionable success/failure pairs by task and model", () => {
    const success = result("a", 1, true);
    success.metrics = {
      ...success.metrics,
      trajectoryAvailable: true,
      timeToFirstEditMs: 100,
      readOnlyTurns: 1,
      rereads: 0,
      verifications: 2,
      toolErrors: 0,
    };
    const failure = result("a", 2, false);
    failure.metrics = {
      ...failure.metrics,
      trajectoryAvailable: true,
      timeToFirstEditMs: 500,
      readOnlyTurns: 3,
      rereads: 2,
      verifications: 0,
      toolErrors: 2,
    };
    const report: RunReport = {
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:01:00Z",
      agents: ["test"],
      results: [success, failure],
      manifest: {
        harnessVersion: "test",
        resolvedModel: "model-x",
        platform: "test",
        publishable: false,
      },
    };

    const pairs = buildTrajectoryPairs(report);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      taskId: "a",
      model: "model-x",
      successTrial: 1,
      failureTrial: 2,
    });
    expect(pairs[0]?.insights).toContain("successful trial edited earlier");
  });
});
