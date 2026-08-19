import { describe, expect, it } from "vitest";
import {
  parseNinjaBenchHarborArgs,
  profileHarborArgs,
  uniqueCanaryJobName,
  uniqueSmokeJobName,
  withJobName,
  withReasoningEffort,
} from "./cli.js";
import type { BenchmarkTruthConfig } from "./config.js";

function truthConfig(): BenchmarkTruthConfig {
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
      subset: { expectedTasks: 2, attempts: 3, publishable: false },
      full: { expectedTasks: 89, attempts: 1, publishable: false },
      publish: { expectedTasks: 89, attempts: 3, publishable: true },
    },
    smoke: [{ name: "terminal-bench/path-tracing", stratum: "algorithms" }],
    canary: [{ name: "terminal-bench/write-compressor", stratum: "build" }],
    subset: [
      { name: "terminal-bench/path-tracing", stratum: "algorithms" },
      { name: "terminal-bench/kv-store-grpc", stratum: "software" },
    ],
  };
}

describe("Harbor smoke job names", () => {
  it("generates a unique smoke-<timestamp> name", () => {
    expect(uniqueSmokeJobName(new Date(2026, 7, 16, 10, 33, 29))).toBe("smoke-20260816-103329");
    expect(uniqueCanaryJobName(new Date(2026, 7, 16, 19, 27, 37))).toBe("canary-20260816-192737");
  });

  it("does not override an explicit --job-name", () => {
    expect(withJobName(["--job-name", "smoke-manual", "-o", "runs/harbor"], "smoke-auto")).toEqual([
      "--job-name",
      "smoke-manual",
      "-o",
      "runs/harbor",
    ]);
    expect(withJobName(["-o", "runs/harbor"], "smoke-auto")).toEqual([
      "--job-name",
      "smoke-auto",
      "-o",
      "runs/harbor",
    ]);
  });
});

describe("Harbor profile args", () => {
  it("pins canary to write-compressor with three attempts", () => {
    const args = profileHarborArgs(truthConfig(), "canary", ["-o", "runs/harbor"]);
    expect(args).toContain("terminal-bench/write-compressor");
    expect(args.filter((arg) => arg === "--include-task-name")).toHaveLength(1);
    expect(args).toEqual(
      expect.arrayContaining(["-l", "1", "-k", "3", "--agent", "ninjacode_agent:NinjaCodeAgent"]),
    );
  });

  it("pins smoke to path-tracing via --include-task-name", () => {
    const args = profileHarborArgs(truthConfig(), "smoke", ["-o", "runs/harbor"]);
    expect(args).toContain("--include-task-name");
    expect(args).toContain("terminal-bench/path-tracing");
    expect(args.filter((arg) => arg === "--include-task-name")).toHaveLength(1);
    expect(args).toEqual(
      expect.arrayContaining(["-l", "1", "-k", "1", "--agent", "ninjacode_agent:NinjaCodeAgent"]),
    );
  });

  it("pins every subset task and leaves full unfiltered", () => {
    const config = truthConfig();
    const subset = profileHarborArgs(config, "subset", []);
    expect(subset.filter((arg) => arg === "--include-task-name")).toHaveLength(2);
    expect(subset).toContain("terminal-bench/kv-store-grpc");
    expect(profileHarborArgs(config, "full", [])).not.toContain("--include-task-name");
  });
});

describe("Harbor A/B effort override", () => {
  it("strips ninjabench-only flags before forwarding to Harbor", () => {
    const parsed = parseNinjaBenchHarborArgs([
      "-o",
      "runs/harbor",
      "--job-name",
      "canary-xhigh",
      "--reasoning-effort",
      "xhigh",
      "--reuse-bundle",
    ]);
    expect(parsed).toEqual({
      reasoningEffort: "xhigh",
      reuseBundle: true,
      harborArgs: ["-o", "runs/harbor", "--job-name", "canary-xhigh"],
    });
  });

  it("rewrites only the pinned effort on the same config", () => {
    const raised = withReasoningEffort(truthConfig(), "xhigh");
    expect(raised.reasoningEffort).toBe("xhigh");
    expect(raised.model).toBe("xai/grok-4.6");
    expect(raised.node.preferredVersion).toBe("24.19.0");
  });
});
