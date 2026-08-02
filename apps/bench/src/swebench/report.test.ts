import { describe, expect, it } from "vitest";
import { compareEvalRuns, predictDeltaToMarkdown, predictMetaToMarkdown, toCompareMarkdown } from "./report.js";
import { summarizePredictTelemetry } from "./telemetry.js";
import type { EvalRunMeta, PredictInstanceRecord, PredictRunMeta } from "./types.js";

describe("compareEvalRuns", () => {
  it("sorts agents by pass rate descending", () => {
    const evals: EvalRunMeta[] = [
      {
        runId: "a",
        predictionsPath: "/runs/ninjacode.jsonl",
        dataset: "princeton-nlp/SWE-bench_Lite",
        startedAt: "",
        finishedAt: "",
        resolved: ["x"],
        unresolved: ["y", "z"],
        errors: [],
        total: 3,
        resolvedCount: 1,
        passRate: 1 / 3,
        reportPath: "/runs/a.eval.json",
      },
      {
        runId: "b",
        predictionsPath: "/runs/claude-code.jsonl",
        dataset: "princeton-nlp/SWE-bench_Lite",
        startedAt: "",
        finishedAt: "",
        resolved: ["x", "y"],
        unresolved: ["z"],
        errors: [],
        total: 3,
        resolvedCount: 2,
        passRate: 2 / 3,
        reportPath: "/runs/b.eval.json",
      },
    ];
    const rows = compareEvalRuns(evals);
    expect(rows[0]?.agent).toBe("claude-code");
    expect(toCompareMarkdown(rows, evals)).toContain("66.7%");
  });
});

function predictMeta(records: PredictInstanceRecord[], over: Partial<PredictRunMeta> = {}): PredictRunMeta {
  return {
    agentName: "ninjacode/anthropic",
    modelNameOrPath: "ninjacode/anthropic",
    startedAt: "",
    finishedAt: "",
    dataset: "princeton-nlp/SWE-bench_Lite",
    instanceIds: records.map((r) => r.instanceId),
    totalInstances: records.length,
    succeeded: records.filter((r) => r.status === "ok").length,
    timedOut: 0,
    agentErrors: 0,
    emptyPatches: records.filter((r) => r.emptyPatch).length,
    totalWallTimeMs: 1000,
    predictionsPath: "/runs/ninjacode.jsonl",
    instances: records,
    telemetry: summarizePredictTelemetry(records),
    ...over,
  };
}

const instance: PredictInstanceRecord = {
  instanceId: "sympy__sympy-1",
  status: "ok",
  emptyPatch: false,
  wallTimeMs: 1000,
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: 0.02,
  turns: 5,
  toolCalls: 8,
  toolErrors: 0,
};

describe("predictMetaToMarkdown", () => {
  it("reports the cache read rate and outcome taxonomy", () => {
    const md = predictMetaToMarkdown([
      predictMeta([
        { ...instance, inputTokens: 100, cacheReadTokens: 900 },
        { ...instance, instanceId: "django__django-2", emptyPatch: true },
      ]),
    ]);
    expect(md).toContain("Cache read rate:");
    expect(md).toContain("empty_patch=1");
    expect(md).toContain("patch_produced=1");
  });

  it("says so when the adapter reports no token telemetry", () => {
    const md = predictMetaToMarkdown([
      predictMeta([{ instanceId: "cli-1", status: "ok", emptyPatch: false, wallTimeMs: 5 }]),
    ]);
    expect(md).toContain("Token telemetry: unavailable");
  });
});

describe("predictDeltaToMarkdown", () => {
  it("marks a token reduction as better and a regression as worse", () => {
    const baseline = predictMeta([{ ...instance, inputTokens: 1000, cacheReadTokens: 0 }]);
    const current = predictMeta([{ ...instance, inputTokens: 500, cacheReadTokens: 500, turns: 9 }]);
    const md = predictDeltaToMarkdown(baseline, current);
    expect(md).toMatch(/Uncached input tokens \|.*\| -50\.0% \(better\)/);
    expect(md).toMatch(/Avg turns \|.*\(worse\)/);
  });
});
