import type {
  PredictDeltaRow,
  PredictInstanceRecord,
  PredictRunMeta,
  PredictTelemetry,
} from "./types.js";

function sum(records: PredictInstanceRecord[], pick: (r: PredictInstanceRecord) => number | undefined): number {
  return records.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
}

function average(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}

function mergeToolHistograms(records: PredictInstanceRecord[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [tool, count] of Object.entries(record.toolHistogram ?? {})) {
      merged[tool] = (merged[tool] ?? 0) + count;
    }
  }
  return merged;
}

/**
 * Fold per-instance records into the aggregates the baseline report tracks.
 * Only instances that reported token counters contribute to the averages, so a
 * run mixing in-process and CLI agents does not dilute them.
 */
export function summarizePredictTelemetry(records: PredictInstanceRecord[]): PredictTelemetry {
  const withTelemetry = records.filter((r) => r.inputTokens !== undefined);
  const inputTokens = sum(withTelemetry, (r) => r.inputTokens);
  const cacheReadTokens = sum(withTelemetry, (r) => r.cacheReadTokens);
  const cacheWriteTokens = sum(withTelemetry, (r) => r.cacheWriteTokens);
  const totalPromptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
  const withCost = withTelemetry.filter((r) => r.estimatedCostUsd !== undefined);

  return {
    instancesWithTelemetry: withTelemetry.length,
    inputTokens,
    outputTokens: sum(withTelemetry, (r) => r.outputTokens),
    cacheReadTokens,
    cacheWriteTokens,
    cacheReadRate: totalPromptTokens > 0 ? cacheReadTokens / totalPromptTokens : 0,
    avgTurns: average(sum(withTelemetry, (r) => r.turns), withTelemetry.length),
    avgToolCalls: average(sum(withTelemetry, (r) => r.toolCalls), withTelemetry.length),
    toolErrors: sum(withTelemetry, (r) => r.toolErrors),
    avgCostUsd:
      withCost.length > 0
        ? average(sum(withCost, (r) => r.estimatedCostUsd), withCost.length)
        : undefined,
    toolHistogram: mergeToolHistograms(withTelemetry),
  };
}

/** Count instances per failure kind, including the empty-patch case. */
export function countFailureCauses(records: PredictInstanceRecord[]): Record<string, number> {
  const causes: Record<string, number> = {};
  const bump = (key: string): void => {
    causes[key] = (causes[key] ?? 0) + 1;
  };
  for (const record of records) {
    if (record.status !== "ok") bump(record.status);
    else if (record.emptyPatch) bump("empty_patch");
    else bump("patch_produced");
  }
  return causes;
}

/**
 * Narrow a run to a set of instances and recompute its aggregates. A cheaper
 * re-run on a subset is only comparable to the baseline once the baseline is
 * reduced to the same instances.
 */
export function subsetPredictMeta(meta: PredictRunMeta, instanceIds: string[]): PredictRunMeta {
  const wanted = new Set(instanceIds);
  const instances = meta.instances.filter((r) => wanted.has(r.instanceId));
  return {
    ...meta,
    instanceIds: instances.map((r) => r.instanceId),
    totalInstances: instances.length,
    succeeded: instances.filter((r) => r.status === "ok").length,
    timedOut: instances.filter((r) => r.status === "timeout").length,
    agentErrors: instances.filter((r) => r.status === "agent_error").length,
    emptyPatches: instances.filter((r) => r.emptyPatch).length,
    totalWallTimeMs: instances.reduce((acc, r) => acc + r.wallTimeMs, 0),
    instances,
    telemetry: summarizePredictTelemetry(instances),
  };
}

function deltaRow(
  metric: string,
  baseline: number,
  current: number,
  higherIsBetter: boolean,
): PredictDeltaRow {
  return {
    metric,
    baseline,
    current,
    changeRatio: baseline === 0 ? undefined : (current - baseline) / baseline,
    higherIsBetter,
  };
}

/**
 * Compare two predict runs on the metrics this harness optimizes for. Pass rate
 * is not here: it comes from the Docker eval, not from prediction.
 */
export function diffPredictRuns(
  baseline: { telemetry: PredictTelemetry; emptyPatches: number; totalInstances: number },
  current: { telemetry: PredictTelemetry; emptyPatches: number; totalInstances: number },
): PredictDeltaRow[] {
  return [
    deltaRow("Cache read rate", baseline.telemetry.cacheReadRate, current.telemetry.cacheReadRate, true),
    deltaRow("Uncached input tokens", baseline.telemetry.inputTokens, current.telemetry.inputTokens, false),
    deltaRow("Output tokens", baseline.telemetry.outputTokens, current.telemetry.outputTokens, false),
    deltaRow("Cache read tokens", baseline.telemetry.cacheReadTokens, current.telemetry.cacheReadTokens, true),
    deltaRow("Avg turns", baseline.telemetry.avgTurns, current.telemetry.avgTurns, false),
    deltaRow("Avg tool calls", baseline.telemetry.avgToolCalls, current.telemetry.avgToolCalls, false),
    deltaRow("Tool errors", baseline.telemetry.toolErrors, current.telemetry.toolErrors, false),
    deltaRow("Avg cost USD", baseline.telemetry.avgCostUsd ?? 0, current.telemetry.avgCostUsd ?? 0, false),
    deltaRow("Empty patches", baseline.emptyPatches, current.emptyPatches, false),
  ];
}
