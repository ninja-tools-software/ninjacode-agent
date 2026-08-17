import fs from "node:fs/promises";
import path from "node:path";
import { benchRoot } from "./paths.js";

export type HarborProfileName = "smoke" | "canary" | "subset" | "full" | "publish";

export interface HarborPinnedTask {
  name: string;
  stratum: string;
}

export interface BenchmarkTruthConfig {
  schemaVersion: 1;
  dataset: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
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
    {
      expectedTasks: number;
      attempts: number;
      publishable: boolean;
      minimumCorrectionPassRate?: number;
      maximumAgentTimeoutRate?: number;
    }
  >;
  smoke: HarborPinnedTask[];
  canary: HarborPinnedTask[];
  subset: HarborPinnedTask[];
}

export function pinnedTasksForProfile(
  config: BenchmarkTruthConfig,
  profile: HarborProfileName,
): HarborPinnedTask[] {
  if (profile === "smoke") return config.smoke;
  if (profile === "canary") return config.canary;
  if (profile === "subset") return config.subset;
  return [];
}

export function assertBenchmarkTruthConfig(
  parsed: BenchmarkTruthConfig,
  configPath: string,
): BenchmarkTruthConfig {
  if (
    parsed.schemaVersion !== 1 ||
    !parsed.dataset ||
    !parsed.model ||
    !parsed.harborVersion ||
    !Array.isArray(parsed.smoke) ||
    !Array.isArray(parsed.canary) ||
    !Array.isArray(parsed.subset) ||
    parsed.smoke.length !== parsed.profiles.smoke.expectedTasks ||
    parsed.canary.length !== parsed.profiles.canary.expectedTasks ||
    parsed.subset.length !== parsed.profiles.subset.expectedTasks
  ) {
    throw new Error(`Invalid benchmark truth config: ${configPath}`);
  }
  return parsed;
}

function benchmarkTruthConfigPath(): string {
  return path.join(benchRoot(), "config", "benchmark-truth.json");
}

export async function loadBenchmarkTruthConfig(): Promise<BenchmarkTruthConfig> {
  const configPath = benchmarkTruthConfigPath();
  const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as BenchmarkTruthConfig;
  return assertBenchmarkTruthConfig(parsed, configPath);
}
