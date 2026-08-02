import { describe, expect, it } from "vitest";
import { estimateCostUsd, repricePredictMeta } from "./cost.js";
import { summarizePredictTelemetry } from "./telemetry.js";
import type { PredictInstanceRecord, PredictRunMeta } from "./types.js";

const DEEPSEEK = { input: 0.14, output: 0.28, cacheRead: 0.014 };

function record(over: Partial<PredictInstanceRecord> = {}): PredictInstanceRecord {
  return {
    instanceId: "repo__pkg-1",
    status: "ok",
    emptyPatch: false,
    wallTimeMs: 1000,
    inputTokens: 1e6,
    outputTokens: 1e6,
    cacheReadTokens: 1e6,
    cacheWriteTokens: 0,
    estimatedCostUsd: 99,
    ...over,
  };
}

describe("estimateCostUsd", () => {
  it("prices each token bucket with its own rate", () => {
    expect(estimateCostUsd(record(), DEEPSEEK)).toBeCloseTo(0.14 + 0.28 + 0.014);
  });

  it("derives a cache-read rate when the table omits one", () => {
    const pricing = { input: 3, output: 15 };
    expect(estimateCostUsd(record({ outputTokens: 0, inputTokens: 0 }), pricing)).toBeCloseTo(0.3);
  });

  it("costs nothing for an instance that reported no tokens", () => {
    const empty = record({
      inputTokens: undefined,
      outputTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    });
    expect(estimateCostUsd(empty, DEEPSEEK)).toBe(0);
  });
});

describe("repricePredictMeta", () => {
  const records = [record({ instanceId: "a" }), { instanceId: "b", status: "ok" as const, emptyPatch: true, wallTimeMs: 1 }];
  const meta: PredictRunMeta = {
    agentName: "ninjacode",
    modelNameOrPath: "ninjacode",
    startedAt: "",
    finishedAt: "",
    dataset: "princeton-nlp/SWE-bench_Lite",
    instanceIds: ["a", "b"],
    totalInstances: 2,
    succeeded: 2,
    timedOut: 0,
    agentErrors: 0,
    emptyPatches: 1,
    totalWallTimeMs: 1001,
    totalCostUsd: 99,
    predictionsPath: "/runs/ninjacode.jsonl",
    instances: records,
    telemetry: summarizePredictTelemetry(records),
  };

  it("replaces a stale cost estimate with one from the given price table", () => {
    const repriced = repricePredictMeta(meta, DEEPSEEK);
    expect(repriced.instances[0]?.estimatedCostUsd).toBeCloseTo(0.434);
    expect(repriced.totalCostUsd).toBeCloseTo(0.434);
    expect(repriced.telemetry.avgCostUsd).toBeCloseTo(0.434);
  });

  it("leaves instances without token telemetry alone", () => {
    const repriced = repricePredictMeta(meta, DEEPSEEK);
    expect(repriced.instances[1]?.estimatedCostUsd).toBeUndefined();
  });
});
