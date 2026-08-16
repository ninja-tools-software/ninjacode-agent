import fs from "node:fs/promises";
import path from "node:path";
import { benchRoot } from "./paths.js";

export type HarborProfileName = "smoke" | "subset" | "full" | "publish";

export interface BenchmarkTruthConfig {
  schemaVersion: 1;
  dataset: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high";
  harborVersion: string;
  node: { minimumMajor: number; preferredVersion: string };
  timeouts: {
    cliRunMs: number;
    agentMultiplier: number;
    verifierMultiplier: number;
  };
  gates: {
    minimumTelemetryCoverage: number;
    maximumInfrastructureErrorRate: number;
  };
  profiles: Record<
    HarborProfileName,
    { expectedTasks: number; attempts: number; publishable: boolean }
  >;
  subset: Array<{ name: string; stratum: string }>;
}

function benchmarkTruthConfigPath(): string {
  return path.join(benchRoot(), "config", "benchmark-truth.json");
}

export async function loadBenchmarkTruthConfig(): Promise<BenchmarkTruthConfig> {
  const parsed = JSON.parse(
    await fs.readFile(benchmarkTruthConfigPath(), "utf8"),
  ) as BenchmarkTruthConfig;
  if (
    parsed.schemaVersion !== 1 ||
    !parsed.dataset ||
    !parsed.model ||
    !parsed.harborVersion ||
    parsed.subset.length !== parsed.profiles.subset.expectedTasks
  ) {
    throw new Error(`Invalid benchmark truth config: ${benchmarkTruthConfigPath()}`);
  }
  return parsed;
}
