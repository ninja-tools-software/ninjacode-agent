import { describe, expect, it } from "vitest";
import {
  countFailureCauses,
  diffPredictRuns,
  subsetPredictMeta,
  summarizePredictTelemetry,
} from "./telemetry.js";
import type { PredictInstanceRecord, PredictRunMeta } from "./types.js";

function record(over: Partial<PredictInstanceRecord> = {}): PredictInstanceRecord {
  return {
    instanceId: "repo__pkg-1",
    status: "ok",
    emptyPatch: false,
    wallTimeMs: 1000,
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0.01,
    turns: 4,
    toolCalls: 6,
    toolErrors: 1,
    ...over,
  };
}

describe("summarizePredictTelemetry", () => {
  it("computes the cache read rate over all prompt token buckets", () => {
    const telemetry = summarizePredictTelemetry([
      record({ inputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0 }),
    ]);
    expect(telemetry.cacheReadRate).toBeCloseTo(0.9);
  });

  it("counts cache writes as uncached cost in the rate denominator", () => {
    const telemetry = summarizePredictTelemetry([
      record({ inputTokens: 0, cacheReadTokens: 500, cacheWriteTokens: 500 }),
    ]);
    expect(telemetry.cacheReadRate).toBeCloseTo(0.5);
  });

  it("returns a zero rate when nothing was sent", () => {
    const telemetry = summarizePredictTelemetry([
      record({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ]);
    expect(telemetry.cacheReadRate).toBe(0);
  });

  it("ignores instances without token telemetry in the averages", () => {
    const telemetry = summarizePredictTelemetry([
      record({ turns: 10 }),
      { instanceId: "cli__agent-1", status: "ok", emptyPatch: false, wallTimeMs: 5 },
    ]);
    expect(telemetry.instancesWithTelemetry).toBe(1);
    expect(telemetry.avgTurns).toBe(10);
  });

  it("leaves the average cost undefined when no instance reported one", () => {
    const telemetry = summarizePredictTelemetry([record({ estimatedCostUsd: undefined })]);
    expect(telemetry.avgCostUsd).toBeUndefined();
  });

  it("sums the tool histogram across instances", () => {
    const telemetry = summarizePredictTelemetry([
      record({ toolHistogram: { grep: 3, edit_file: 1 } }),
      record({ toolHistogram: { grep: 2, run_shell: 4 } }),
    ]);
    expect(telemetry.toolHistogram).toEqual({ grep: 5, edit_file: 1, run_shell: 4 });
  });
});

describe("countFailureCauses", () => {
  it("separates empty patches from produced patches and hard failures", () => {
    const causes = countFailureCauses([
      record(),
      record({ emptyPatch: true }),
      record({ status: "timeout" }),
      record({ status: "agent_error" }),
    ]);
    expect(causes).toEqual({ patch_produced: 1, empty_patch: 1, timeout: 1, agent_error: 1 });
  });
});

describe("diffPredictRuns", () => {
  const base = {
    telemetry: summarizePredictTelemetry([record({ inputTokens: 1000, cacheReadTokens: 0 })]),
    emptyPatches: 2,
    totalInstances: 10,
  };

  it("reports the relative change per metric", () => {
    const current = {
      telemetry: summarizePredictTelemetry([record({ inputTokens: 500, cacheReadTokens: 500 })]),
      emptyPatches: 1,
      totalInstances: 10,
    };
    const rows = diffPredictRuns(base, current);
    const input = rows.find((r) => r.metric === "Uncached input tokens");
    expect(input?.changeRatio).toBeCloseTo(-0.5);
    expect(input?.higherIsBetter).toBe(false);
    expect(rows.find((r) => r.metric === "Cache read rate")?.higherIsBetter).toBe(true);
  });

  it("omits the ratio when the baseline metric is zero", () => {
    const rows = diffPredictRuns(base, base);
    expect(rows.find((r) => r.metric === "Cache read rate")?.changeRatio).toBeUndefined();
  });
});

describe("subsetPredictMeta", () => {
  const records = [
    record({ instanceId: "a", inputTokens: 1000 }),
    record({ instanceId: "b", inputTokens: 3000, emptyPatch: true, status: "timeout" }),
    record({ instanceId: "c", inputTokens: 2000 }),
  ];
  const meta: PredictRunMeta = {
    agentName: "ninjacode",
    modelNameOrPath: "ninjacode",
    startedAt: "",
    finishedAt: "",
    dataset: "princeton-nlp/SWE-bench_Lite",
    instanceIds: ["a", "b", "c"],
    totalInstances: 3,
    succeeded: 2,
    timedOut: 1,
    agentErrors: 0,
    emptyPatches: 1,
    totalWallTimeMs: 3000,
    predictionsPath: "/runs/ninjacode.jsonl",
    instances: records,
    telemetry: summarizePredictTelemetry(records),
  };

  it("recomputes aggregates over the retained instances only", () => {
    const subset = subsetPredictMeta(meta, ["a", "c"]);
    expect(subset.totalInstances).toBe(2);
    expect(subset.telemetry.inputTokens).toBe(3000);
    expect(subset.emptyPatches).toBe(0);
    expect(subset.timedOut).toBe(0);
  });

  it("ignores instance ids the run never covered", () => {
    const subset = subsetPredictMeta(meta, ["a", "does-not-exist"]);
    expect(subset.instanceIds).toEqual(["a"]);
  });
});
