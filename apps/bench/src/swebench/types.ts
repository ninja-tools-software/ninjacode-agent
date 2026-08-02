/** One row from princeton-nlp/SWE-bench_Lite (test split). */
export interface SweBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  created_at?: string;
  version?: string;
  environment_setup_commit?: string;
  patch?: string;
  test_patch?: string;
  FAIL_TO_PASS?: string;
  PASS_TO_PASS?: string;
}

/** Official SWE-bench predictions JSONL line. */
export interface SweBenchPrediction {
  instance_id: string;
  model_name_or_path: string;
  model_patch: string;
}

/** Why an instance produced no usable patch — the failure taxonomy of a run. */
export type PredictInstanceStatus = "ok" | "timeout" | "agent_error";

/** Per-instance telemetry: the unit the baseline report aggregates over. */
export interface PredictInstanceRecord {
  instanceId: string;
  status: PredictInstanceStatus;
  emptyPatch: boolean;
  wallTimeMs: number;
  /** Token counters are disjoint buckets: uncached input, cache reads, cache writes. */
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimatedCostUsd?: number;
  turns?: number;
  toolCalls?: number;
  toolErrors?: number;
  /** Calls per tool name — tells exploration-heavy runs apart from editing ones. */
  toolHistogram?: Record<string, number>;
  errorMessage?: string;
}

/** Aggregates over the instances that reported in-process telemetry. */
export interface PredictTelemetry {
  instancesWithTelemetry: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /**
   * cacheRead / (uncachedInput + cacheRead + cacheWrite) — the prompt-cache hit
   * rate. This is the headline number for prefix stability: it collapses when
   * the system prompt or tool specs change mid-session.
   */
  cacheReadRate: number;
  avgTurns: number;
  avgToolCalls: number;
  toolErrors: number;
  avgCostUsd?: number;
  /** Calls per tool name summed over the run — the shape of how turns were spent. */
  toolHistogram: Record<string, number>;
}

export interface PredictRunMeta {
  agentName: string;
  modelNameOrPath: string;
  startedAt: string;
  finishedAt: string;
  gitCommit?: string;
  dataset: string;
  instanceIds: string[];
  totalInstances: number;
  succeeded: number;
  timedOut: number;
  agentErrors: number;
  emptyPatches: number;
  totalWallTimeMs: number;
  totalCostUsd?: number;
  predictionsPath: string;
  /** Per-instance records, so a later run can be diffed instance by instance. */
  instances: PredictInstanceRecord[];
  telemetry: PredictTelemetry;
}

/** One metric compared between a baseline predict run and the current one. */
export interface PredictDeltaRow {
  metric: string;
  baseline: number;
  current: number;
  /** Relative change; undefined when the baseline is 0 (no meaningful ratio). */
  changeRatio?: number;
  /** Whether a higher value is better, for reading the sign of the change. */
  higherIsBetter: boolean;
}

export interface EvalRunMeta {
  runId: string;
  predictionsPath: string;
  dataset: string;
  startedAt: string;
  finishedAt: string;
  resolved: string[];
  unresolved: string[];
  errors: string[];
  total: number;
  resolvedCount: number;
  passRate: number;
  logsDir?: string;
  reportPath: string;
}

export interface CompareRow {
  agent: string;
  modelNameOrPath: string;
  resolved: number;
  total: number;
  passRate: number;
  runId: string;
  reportPath: string;
  predictionsPath?: string;
}
