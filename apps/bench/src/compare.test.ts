import { describe, expect, it } from "vitest";
import { compareReports, compareToMarkdown, totals } from "./compare.js";
import type { RunReport, TaskResult } from "./types.js";

function result(partial: Partial<TaskResult> & { taskId: string; passed: boolean }): TaskResult {
  return {
    agentName: "ninjacode",
    trial: 1,
    metrics: {
      wallTimeMs: 1000,
      filesChanged: 1,
      linesAdded: 1,
      linesRemoved: 0,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 200,
      turns: 3,
      toolCalls: 5,
      toolErrors: 1,
      estimatedCostUsd: 0.01,
    },
    outputTail: "",
    ...partial,
  };
}

function report(results: TaskResult[], startedAt = "2026-01-01T00:00:00Z"): RunReport {
  return {
    startedAt,
    finishedAt: "2026-01-01T00:01:00Z",
    gitCommit: "abc1234",
    agents: ["ninjacode"],
    results,
  };
}

describe("totals", () => {
  it("aggregates metrics and cache read rate", () => {
    const t = totals(
      report([
        result({ taskId: "a", passed: true }),
        result({
          taskId: "b",
          passed: false,
          metrics: {
            wallTimeMs: 2000,
            filesChanged: 0,
            linesAdded: 0,
            linesRemoved: 0,
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            turns: 2,
            toolCalls: 2,
            toolErrors: 0,
            estimatedCostUsd: 0.02,
          },
        }),
      ]),
    );
    expect(t.passRate).toBe(0.5);
    expect(t.inputTokens).toBe(200);
    expect(t.cacheReadTokens).toBe(200);
    expect(t.cacheReadRate).toBeCloseTo(200 / 400);
    expect(t.estimatedCostUsd).toBeCloseTo(0.03);
  });
});

describe("compareReports", () => {
  it("computes overall and per-task deltas", () => {
    const baseline = report([
      result({ taskId: "fix-a", passed: true }),
      result({ taskId: "fix-b", passed: false }),
    ]);
    const after = report(
      [
        result({ taskId: "fix-a", passed: true }),
        result({ taskId: "fix-b", passed: true }),
      ],
      "2026-01-02T00:00:00Z",
    );
    const c = compareReports(baseline, after);
    expect(c.deltas.passRate).toBeCloseTo(0.5);
    const b = c.perTask.find((t) => t.taskId === "fix-b");
    expect(b?.delta).toBe(1);
    expect(b?.baselinePassRate).toBe(0);
    expect(b?.afterPassRate).toBe(1);
  });
});

describe("compareToMarkdown", () => {
  it("renders a markdown table with deltas", () => {
    const md = compareToMarkdown(
      report([result({ taskId: "t", passed: false })]),
      report([result({ taskId: "t", passed: true })], "2026-01-02T00:00:00Z"),
    );
    expect(md).toContain("# NinjaBench compare");
    expect(md).toContain("Pass rate");
    expect(md).toContain("| t |");
    expect(md).toContain("↑");
  });
});
