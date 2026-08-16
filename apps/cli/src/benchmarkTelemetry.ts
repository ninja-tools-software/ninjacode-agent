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
  completed: boolean;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  toolHistogram: Record<string, number>;
}

function toolHistogram(names: string[]): Record<string, number> {
  const histogram: Record<string, number> = {};
  for (const name of names) histogram[name] = (histogram[name] ?? 0) + 1;
  return histogram;
}

export function collectBenchmarkTelemetry(
  agent: TelemetryAgent,
  outcome: AgentOutcome,
): BenchmarkTelemetry {
  const stats = agent.getCacheStats();
  const invocations = outcome.turns.flatMap((turn) => turn.toolInvocations);
  return {
    schemaVersion: 1,
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
  };
}

export async function writeBenchmarkTelemetry(
  agent: TelemetryAgent,
  outcome: AgentOutcome,
  outputPath = process.env.NINJACODE_BENCH_TELEMETRY_FILE,
): Promise<void> {
  if (!outputPath) return;
  const telemetry = collectBenchmarkTelemetry(agent, outcome);
  const absolutePath = path.resolve(outputPath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(temporaryPath, `${JSON.stringify(telemetry)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, absolutePath);
}
