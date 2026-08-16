import { createHash } from "node:crypto";
import os from "node:os";
import type { RunManifest } from "./types.js";
import { ablationComponents, type AblationVariant } from "./ablations.js";

export const HARNESS_VERSION = "1.2.0";

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildRunManifest(opts: {
  gitSha?: string;
  promptHash?: string;
  rulesHash?: string;
  resolvedModel?: string;
  provider?: string;
  reasoningEffort?: string;
  publishable: boolean;
  maxTurns?: number;
  maxCostUsd?: number;
  runTimeoutMs?: number;
  sandboxMode?: string;
  mcpProtocol?: string;
  contextSchema?: string;
  temperature?: number;
  taskSource?: "repository" | "external-holdout";
  taskCount?: number;
  trials?: number;
  taskSetHash?: string;
  bundleSha256?: string;
  harborVersion?: string;
  ablation?: AblationVariant;
}): RunManifest {
  return {
    harnessVersion: HARNESS_VERSION,
    gitSha: opts.gitSha,
    promptHash: opts.promptHash,
    rulesHash: opts.rulesHash,
    resolvedModel: opts.resolvedModel,
    provider: opts.provider,
    reasoningEffort: opts.reasoningEffort,
    temperature: opts.temperature ?? 0,
    budgets: {
      maxTurns: opts.maxTurns,
      maxCostUsd: opts.maxCostUsd,
      runTimeoutMs: opts.runTimeoutMs,
    },
    runtime: {
      nodeVersion: process.version,
      bundleSha256: opts.bundleSha256,
      harborVersion: opts.harborVersion,
    },
    taskSet:
      opts.taskCount !== undefined && opts.trials !== undefined && opts.taskSetHash
        ? {
            source: opts.taskSource ?? "repository",
            count: opts.taskCount,
            trials: opts.trials,
            hash: opts.taskSetHash,
          }
        : undefined,
    ablation: opts.ablation
      ? {
          name: opts.ablation.name,
          disabled: [...opts.ablation.disabled],
          components: ablationComponents(opts.ablation),
        }
      : undefined,
    platform: `${os.platform()}-${os.arch()}-${os.release()}`,
    sandboxMode: opts.sandboxMode ?? "danger-full-access",
    contextSchema: opts.contextSchema ?? "context-v2",
    mcpProtocol: opts.mcpProtocol ?? "none",
    publishable: opts.publishable,
  };
}
