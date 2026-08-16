import { describe, expect, it } from "vitest";
import {
  compareReports,
  compareToMarkdown,
  evaluateCompareGates,
  totals,
} from "./compare.js";
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

  it("reports incompatible task coverage instead of inventing zero pass rates", () => {
    const comparison = compareReports(
      report([result({ taskId: "baseline-only", passed: true })]),
      report([result({ taskId: "current-only", passed: true })]),
    );
    expect(comparison.coverage).toMatchObject({
      comparable: false,
      onlyBaseline: ["baseline-only"],
      onlyAfter: ["current-only"],
    });
    expect(comparison.perTask).toEqual([]);
  });

  it("detects trial-count mismatches", () => {
    const comparison = compareReports(
      report([result({ taskId: "a", passed: true })]),
      report([
        result({ taskId: "a", passed: true }),
        result({ taskId: "a", passed: true, trial: 2 }),
      ]),
    );
    expect(comparison.coverage.trialCountMismatches).toEqual([
      { taskId: "a", baseline: 1, after: 2 },
    ]);
  });

  it("rejects a different agent even with matching task counts", () => {
    const baseline = report([result({ taskId: "a", passed: true })]);
    const current = {
      ...report([result({ taskId: "a", passed: true, agentName: "competitor" })]),
      agents: ["competitor"],
    };
    expect(compareReports(baseline, current).coverage.agentMismatch).toEqual({
      baseline: ["ninjacode"],
      after: ["competitor"],
    });
  });
});

describe("evaluateCompareGates", () => {
  it("fails configured quality, cost, latency, and reliability regressions", () => {
    const baseline = report([
      result({ taskId: "a", passed: true }),
      result({ taskId: "b", passed: true }),
    ]);
    const current = report([
      result({
        taskId: "a",
        passed: false,
        metrics: {
          ...result({ taskId: "ignored", passed: false }).metrics,
          wallTimeMs: 2000,
          estimatedCostUsd: 0.02,
          toolErrors: 3,
        },
      }),
      result({
        taskId: "b",
        passed: true,
        metrics: {
          ...result({ taskId: "ignored", passed: true }).metrics,
          wallTimeMs: 2000,
          estimatedCostUsd: 0.02,
          toolErrors: 3,
        },
      }),
    ]);
    const gate = evaluateCompareGates(compareReports(baseline, current), {
      minPassRate: 0.75,
      maxPassRateDrop: 0.1,
      maxCostIncreasePercent: 10,
      maxWallTimeIncreasePercent: 10,
      maxToolErrorsIncrease: 0,
    });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toHaveLength(5);
  });

  it("passes an unchanged comparable report", () => {
    const stable = report([result({ taskId: "a", passed: true })]);
    expect(
      evaluateCompareGates(compareReports(stable, stable), {
        minPassRate: 1,
        maxPassRateDrop: 0,
        maxCostIncreasePercent: 0,
      }),
    ).toEqual({ passed: true, failures: [] });
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
