import { describe, expect, it } from "vitest";
import {
  assertBenchmarkTruthConfig,
  loadBenchmarkTruthConfig,
  pinnedTasksForProfile,
  type BenchmarkTruthConfig,
} from "./config.js";

function truthConfig(
  overrides: Partial<Pick<BenchmarkTruthConfig, "smoke" | "canary" | "subset">> = {},
): BenchmarkTruthConfig {
  return {
    schemaVersion: 1,
    dataset: "terminal-bench/terminal-bench-2-1",
    model: "xai/grok-4.6",
    reasoningEffort: "high",
    harborVersion: "0.21.0",
    node: { minimumMajor: 24, preferredVersion: "24.19.0" },
    timeouts: { cliRunMs: 840000, agentMultiplier: 1, verifierMultiplier: 1 },
    gates: { minimumTelemetryCoverage: 0.95, maximumInfrastructureErrorRate: 0.05 },
    profiles: {
      smoke: { expectedTasks: 1, attempts: 1, publishable: false },
      canary: { expectedTasks: 1, attempts: 3, publishable: false },
      subset: { expectedTasks: 20, attempts: 3, publishable: false },
      full: { expectedTasks: 89, attempts: 1, publishable: false },
      publish: { expectedTasks: 89, attempts: 3, publishable: true },
    },
    smoke: [{ name: "terminal-bench/path-tracing", stratum: "algorithms" }],
    canary: [{ name: "terminal-bench/write-compressor", stratum: "build" }],
    subset: Array.from({ length: 20 }, (_, index) => ({
      name: `terminal-bench/task-${index}`,
      stratum: "software",
    })),
    ...overrides,
  };
}

describe("Harbor truth config", () => {
  it("loads the pinned smoke task and matching subset length", async () => {
    const config = await loadBenchmarkTruthConfig();
    expect(config.smoke).toEqual([
      { name: "terminal-bench/path-tracing", stratum: "algorithms" },
    ]);
    expect(config.canary).toEqual([
      { name: "terminal-bench/write-compressor", stratum: "build" },
    ]);
    expect(config.canary).toHaveLength(config.profiles.canary.expectedTasks);
    expect(config.profiles.canary.attempts).toBe(3);
    expect(config.profiles.canary.maximumAgentTimeoutRate).toBe(0);
    expect(config.profiles.canary.minimumCorrectionPassRate).toBeGreaterThan(0.6);
    expect(config.subset).toHaveLength(config.profiles.subset.expectedTasks);
  });

  it("pins include-task lists for smoke, canary, and subset", () => {
    const config = truthConfig();
    expect(pinnedTasksForProfile(config, "smoke").map((task) => task.name)).toEqual([
      "terminal-bench/path-tracing",
    ]);
    expect(pinnedTasksForProfile(config, "canary").map((task) => task.name)).toEqual([
      "terminal-bench/write-compressor",
    ]);
    expect(pinnedTasksForProfile(config, "subset")).toHaveLength(20);
    expect(pinnedTasksForProfile(config, "full")).toEqual([]);
    expect(pinnedTasksForProfile(config, "publish")).toEqual([]);
  });

  it("rejects a smoke list that does not match expectedTasks", () => {
    expect(() =>
      assertBenchmarkTruthConfig(truthConfig({ smoke: [] }), "truth.json"),
    ).toThrow(/Invalid benchmark truth config/);
  });
});
