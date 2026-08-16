import fs from "node:fs/promises";
import path from "node:path";
import type { AgentOutcome } from "@ninjacode/core";

interface TelemetryAgent {
  getCacheStats(): {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    estimatedCostUsd: number;
  };
}

interface BenchmarkTelemetry {
  schemaVersion: 1;
  status: "started" | "completed" | "agent_exit";
  telemetryComplete: boolean;
  completed: boolean;
  sessionId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  toolHistogram: Record<string, number>;
  recordedAt: string;
  config?: BenchmarkTelemetryConfig;
}

export interface BenchmarkTelemetryConfig {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  runTimeoutMs?: number;
}

function toolHistogram(names: string[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const name of names) histogram[name] = (histogram[name] ?? 0) + 1;
  return histogram;
}

export function collectBenchmarkTelemetry(
  agent: TelemetryAgent,
  outcome: AgentOutcome,
  config?: BenchmarkTelemetryConfig,
): BenchmarkTelemetry {
  const stats = agent.getCacheStats();
  const invocations = outcome.turns.flatMap((turn) => turn.toolInvocations);
  return {
    schemaVersion: 1,
    status: outcome.completed ? "completed" : "agent_exit",
    telemetryComplete: true,
    completed: outcome.completed,
    sessionId: outcome.sessionId,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cacheReadTokens: stats.cacheReadTokens,
    cacheWriteTokens: stats.cacheWriteTokens,
    estimatedCostUsd: stats.estimatedCostUsd,
    turns: outcome.turns.length,
    toolCalls: invocations.length,
    toolErrors: invocations.filter((invocation) => Boolean(invocation.error)).length,
    toolHistogram: toolHistogram(invocations.map((invocation) => invocation.toolCall.name)),
    recordedAt: new Date().toISOString(),
    config,
  };
}

function startedTelemetry(config?: BenchmarkTelemetryConfig): BenchmarkTelemetry {
  return {
    schemaVersion: 1,
    status: "started",
    telemetryComplete: false,
    completed: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsd: 0,
    turns: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolHistogram: {},
    recordedAt: new Date().toISOString(),
    config,
  };
}

async function writeTelemetryFile(
  telemetry: BenchmarkTelemetry,
  outputPath: string | undefined,
): Promise<void> {
  if (!outputPath) return;
  const absolutePath = path.resolve(outputPath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(telemetry)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, absolutePath);
}

export async function writeBenchmarkTelemetryStart(
  config?: BenchmarkTelemetryConfig,
  outputPath = process.env.NINJACODE_BENCH_TELEMETRY_FILE,
): Promise<void> {
  await writeTelemetryFile(startedTelemetry(config), outputPath);
}

export async function writeBenchmarkTelemetry(
  agent: TelemetryAgent,
  outcome: AgentOutcome,
  outputPath = process.env.NINJACODE_BENCH_TELEMETRY_FILE,
  config?: BenchmarkTelemetryConfig,
): Promise<void> {
  await writeTelemetryFile(collectBenchmarkTelemetry(agent, outcome, config), outputPath);
}
