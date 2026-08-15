import { createHash } from "node:crypto";
import os from "node:os";
import type { RunManifest } from "./types.js";

export const HARNESS_VERSION = "1.1.0";

export function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildRunManifest(opts: {
  gitSha?: string;
  promptHash?: string;
  rulesHash?: string;
  resolvedModel?: string;
  provider?: string;
  publishable: boolean;
  maxTurns?: number;
  maxCostUsd?: number;
  runTimeoutMs?: number;
  sandboxMode?: string;
  mcpProtocol?: string;
  contextSchema?: string;
  temperature?: number;
}): RunManifest {
  return {
    harnessVersion: HARNESS_VERSION,
    gitSha: opts.gitSha,
    promptHash: opts.promptHash,
    rulesHash: opts.rulesHash,
    resolvedModel: opts.resolvedModel,
    provider: opts.provider,
    temperature: opts.temperature ?? 0,
    budgets: {
      maxTurns: opts.maxTurns,
      maxCostUsd: opts.maxCostUsd,
      runTimeoutMs: opts.runTimeoutMs,
    },
    platform: `${os.platform()}-${os.arch()}-${os.release()}`,
    sandboxMode: opts.sandboxMode ?? "danger-full-access",
    contextSchema: opts.contextSchema ?? "context-v2",
    mcpProtocol: opts.mcpProtocol ?? "none",
    publishable: opts.publishable,
  };
}
