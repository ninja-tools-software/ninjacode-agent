import type { RunReport, TaskResult, TrajectoryPairSummary } from "./types.js";
import { isInfrastructureFailure } from "./verdict.js";

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

interface AgentSummary {
  agent: string;
  passRate: number;
  passed: number;
  total: number;
  evaluable: number;
  avgWallTimeSec: number;
  totalCostUsd?: number;
  avgTurns?: number;
  toolErrorRate?: number;
  passAtK?: number;
  passPowK?: number;
  passStdDev?: number;
  passAt3?: number;
  passPow3?: number;
  interTrialVariance?: number;
  passRateConfidence95: ConfidenceInterval;
  wallTimeP50Sec: number;
  wallTimeP95Sec: number;
  firstEditP50Sec?: number;
  firstEditP95Sec?: number;
  costPerSuccessUsd?: number;
  avgReadOnlyTurns?: number;
  avgRereads?: number;
  avgCompactions?: number;
  avgVerifications?: number;
  avgDelegations?: number;
  correctionPassRate: number;
  infrastructureErrorRate: number;
  telemetryCoverage: number;
}

export function summarize(report: RunReport): AgentSummary[] {
  const byAgent = new Map<string, TaskResult[]>();
  for (const r of report.results) {
    const list = byAgent.get(r.agentName) ?? [];
    list.push(r);
    byAgent.set(r.agentName, list);
  }

  const summaries: AgentSummary[] = [];
  for (const [agent, results] of byAgent) {
    const passed = results.filter((r) => r.passed).length;
    const infrastructureErrors = results.filter((result) =>
      isInfrastructureFailure(result.failureKind),
    ).length;
    const evaluable = results.length - infrastructureErrors;
    const costs = results.map((r) => r.metrics.estimatedCostUsd).filter((c): c is number => c !== undefined);
    const turns = results.map((r) => r.metrics.turns).filter((t): t is number => t !== undefined);
    const toolCalls = results.reduce((acc, r) => acc + (r.metrics.toolCalls ?? 0), 0);
    const toolErrors = results.reduce((acc, r) => acc + (r.metrics.toolErrors ?? 0), 0);
    const passStats = computePassAtK(results);
    const statistical = computeTrialStatistics(results);
    const wallTimes = results.map((result) => result.metrics.wallTimeMs);
    const firstEditTimes = results
      .map((result) => result.metrics.timeToFirstEditMs)
      .filter((value): value is number => value !== undefined);
    const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : undefined;
    summaries.push({
      agent,
      passed,
      total: results.length,
      evaluable,
      passRate: results.length ? passed / results.length : 0,
      correctionPassRate: evaluable ? passed / evaluable : 0,
      infrastructureErrorRate: results.length
        ? infrastructureErrors / results.length
        : 0,
      telemetryCoverage: results.length
        ? results.filter((result) => result.metrics.telemetryAvailable === true)
            .length / results.length
        : 0,
      avgWallTimeSec:
        results.reduce((acc, r) => acc + r.metrics.wallTimeMs, 0) / Math.max(results.length, 1) / 1000,
      totalCostUsd: totalCost,
      avgTurns: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : undefined,
      toolErrorRate: toolCalls ? toolErrors / toolCalls : undefined,
      passAtK: passStats.passAtK,
      passPowK: passStats.passPowK,
      passStdDev: passStats.stdDev,
      passAt3: statistical.passAt3,
      passPow3: statistical.passPow3,
      interTrialVariance: statistical.interTrialVariance,
      passRateConfidence95: statistical.confidence95,
      wallTimeP50Sec: percentile(wallTimes, 0.5) / 1000,
      wallTimeP95Sec: percentile(wallTimes, 0.95) / 1000,
      firstEditP50Sec: firstEditTimes.length ? percentile(firstEditTimes, 0.5) / 1000 : undefined,
      firstEditP95Sec: firstEditTimes.length ? percentile(firstEditTimes, 0.95) / 1000 : undefined,
      costPerSuccessUsd: totalCost !== undefined && passed > 0 ? totalCost / passed : undefined,
      avgReadOnlyTurns: averageMetric(results, "readOnlyTurns"),
      avgRereads: averageMetric(results, "rereads"),
      avgCompactions: averageMetric(results, "compactions"),
      avgVerifications: averageMetric(results, "verifications"),
      avgDelegations: averageMetric(results, "delegations"),
    });
  }
  summaries.sort((a, b) => b.passRate - a.passRate);
  return summaries;
}

export function toMarkdown(report: RunReport): string {
  const summaries = summarize(report);
  const lines: string[] = [];
  lines.push(`# NinjaBench report`);
  lines.push("");
  lines.push(`- Run: ${report.startedAt} → ${report.finishedAt}`);
  if (report.gitCommit) lines.push(`- Commit: \`${report.gitCommit}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`| Agent | Correction (95% CI) | Infra | Trajectory | pass@3 | pass^3 | Trial variance | Time p50/p95 | First edit p50/p95 | Cost/success | Read-only / rereads | Verify / delegate |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const s of summaries) {
    lines.push(
      `| ${s.agent} | ${(s.correctionPassRate * 100).toFixed(1)}% (${s.passed}/${s.evaluable}), ` +
        `${formatConfidence(s.passRateConfidence95)} | ` +
        `${(s.infrastructureErrorRate * 100).toFixed(1)}% | ` +
        `${trajectoryCoverage(report.results, s.agent).toFixed(1)}% | ` +
        `${formatRate(s.passAt3)} | ${formatRate(s.passPow3)} | ` +
        `${s.interTrialVariance !== undefined ? s.interTrialVariance.toFixed(4) : "—"} | ` +
        `${s.wallTimeP50Sec.toFixed(1)}s / ${s.wallTimeP95Sec.toFixed(1)}s | ` +
        `${formatSecondsPair(s.firstEditP50Sec, s.firstEditP95Sec)} | ` +
        `${s.costPerSuccessUsd !== undefined ? `$${s.costPerSuccessUsd.toFixed(4)}` : "—"} | ` +
        `${formatAveragePair(s.avgReadOnlyTurns, s.avgRereads)} | ` +
        `${formatAveragePair(s.avgVerifications, s.avgDelegations)} |`,
    );
  }
  lines.push("");
  lines.push(`## Per-task results`);
  lines.push("");
  lines.push(`| Task | Agent | Trial | Result | Time (s) | Files ± | Cost |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of report.results) {
    lines.push(
      `| ${r.taskId} | ${r.agentName} | ${r.trial} | ${r.passed ? "PASS" : `FAIL (${r.failureKind})`} | ` +
        `${(r.metrics.wallTimeMs / 1000).toFixed(1)} | ${r.metrics.filesChanged} (+${r.metrics.linesAdded}/-${r.metrics.linesRemoved}) | ` +
        `${r.metrics.estimatedCostUsd !== undefined ? `$${r.metrics.estimatedCostUsd.toFixed(4)}` : "—"} |`,
    );
  }
  lines.push("");
  appendTrajectoryPairs(lines, buildTrajectoryPairs(report));
  return lines.join("\n");
}

/** Compute pass@k and pass^k across trials grouped by (agent, task). */
export function computePassAtK(results: TaskResult[]): {
  passAtK: number;
  passPowK: number;
  stdDev: number;
} {
  const byTask = new Map<string, boolean[]>();
  for (const r of results) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r.passed);
    byTask.set(r.taskId, list);
  }
  if (byTask.size === 0) return { passAtK: 0, passPowK: 0, stdDev: 0 };

  let passAtSum = 0;
  let passPowSum = 0;
  const rates: number[] = [];
  for (const trials of byTask.values()) {
    const k = trials.length;
    const c = trials.filter(Boolean).length;
    const rate = c / k;
    rates.push(rate);
    passAtSum += c > 0 ? 1 : 0;
    passPowSum += Math.pow(rate, k);
  }
  const n = byTask.size;
  const mean = rates.reduce((a, b) => a + b, 0) / n;
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / n;
  return {
    passAtK: passAtSum / n,
    passPowK: passPowSum / n,
    stdDev: Math.sqrt(variance),
  };
}

interface TrialStatistics {
  passAt3?: number;
  passPow3?: number;
  interTrialVariance?: number;
  confidence95: ConfidenceInterval;
}

/** Statistics are computed per agent by callers; infrastructure failures remain visible trials. */
export function computeTrialStatistics(results: TaskResult[]): TrialStatistics {
  const byTask = new Map<string, TaskResult[]>();
  for (const result of results) {
    const key = `${result.agentName}\u0000${result.taskId}`;
    const list = byTask.get(key) ?? [];
    list.push(result);
    byTask.set(key, list);
  }
  const triples = [...byTask.values()].filter((trials) => trials.length >= 3);
  const completeTriples = triples.length > 0 && triples.length === byTask.size;
  const passAt3 = completeTriples
    ? triples.filter((trials) =>
        [...trials].sort((a, b) => a.trial - b.trial).slice(0, 3).some((trial) => trial.passed)
      ).length / triples.length
    : undefined;
  const passPow3 = completeTriples
    ? triples.filter((trials) =>
        [...trials].sort((a, b) => a.trial - b.trial).slice(0, 3).every((trial) => trial.passed)
      ).length / triples.length
    : undefined;
  const byTrial = new Map<number, { passed: number; total: number }>();
  for (const result of results) {
    const current = byTrial.get(result.trial) ?? { passed: 0, total: 0 };
    current.total += 1;
    if (result.passed) current.passed += 1;
    byTrial.set(result.trial, current);
  }
  const trialRates = [...byTrial.values()].map(({ passed, total }) => passed / Math.max(total, 1));
  return {
    passAt3,
    passPow3,
    interTrialVariance: trialRates.length >= 2 ? sampleVariance(trialRates) : undefined,
    confidence95: wilsonInterval(
      results.filter((result) => result.passed).length,
      results.length,
    ),
  };
}

/** Build one deterministic success/failure contrast for every task and model with both outcomes. */
export function buildTrajectoryPairs(report: RunReport): TrajectoryPairSummary[] {
  const model = report.manifest?.resolvedModel;
  const groups = new Map<string, TaskResult[]>();
  for (const result of report.results) {
    const key = `${result.agentName}\u0000${result.taskId}`;
    const list = groups.get(key) ?? [];
    list.push(result);
    groups.set(key, list);
  }
  const pairs: TrajectoryPairSummary[] = [];
  for (const trials of groups.values()) {
    const success = trials.filter((trial) => trial.passed).sort((a, b) => a.trial - b.trial)[0];
    const failure = trials.filter((trial) => !trial.passed).sort((a, b) => a.trial - b.trial)[0];
    if (!success || !failure) continue;
    const deltas: TrajectoryPairSummary["deltas"] = {
      timeToFirstEditMs: metricDelta(success, failure, "timeToFirstEditMs"),
      readOnlyTurns: metricDelta(success, failure, "readOnlyTurns"),
      rereads: metricDelta(success, failure, "rereads"),
      toolErrors: metricDelta(success, failure, "toolErrors"),
      compactions: metricDelta(success, failure, "compactions"),
      verifications: metricDelta(success, failure, "verifications"),
      delegations: metricDelta(success, failure, "delegations"),
      estimatedCostUsd: metricDelta(success, failure, "estimatedCostUsd"),
      wallTimeMs: success.metrics.wallTimeMs - failure.metrics.wallTimeMs,
    };
    pairs.push({
      taskId: success.taskId,
      agent: success.agentName,
      model: model ?? success.agentName,
      successTrial: success.trial,
      failureTrial: failure.trial,
      deltas,
      insights: pairInsights(deltas),
    });
  }
  return pairs.sort((a, b) =>
    a.model.localeCompare(b.model) || a.taskId.localeCompare(b.taskId) || a.agent.localeCompare(b.agent)
  );
}

function metricDelta(
  success: TaskResult,
  failure: TaskResult,
  key: keyof TaskResult["metrics"],
): number | undefined {
  const successValue = success.metrics[key];
  const failureValue = failure.metrics[key];
  return typeof successValue === "number" && typeof failureValue === "number"
    ? successValue - failureValue
    : undefined;
}

function pairInsights(deltas: TrajectoryPairSummary["deltas"]): string[] {
  const candidates: Array<[number | undefined, string]> = [
    [deltas.timeToFirstEditMs, "successful trial edited later"],
    [deltas.timeToFirstEditMs === undefined ? undefined : -deltas.timeToFirstEditMs, "successful trial edited earlier"],
    [deltas.readOnlyTurns, "successful trial used more read-only turns"],
    [deltas.readOnlyTurns === undefined ? undefined : -deltas.readOnlyTurns, "successful trial used fewer read-only turns"],
    [deltas.rereads, "successful trial reread more"],
    [deltas.rereads === undefined ? undefined : -deltas.rereads, "successful trial reread less"],
    [deltas.verifications, "successful trial verified more"],
    [deltas.toolErrors === undefined ? undefined : -deltas.toolErrors, "successful trial had fewer tool errors"],
  ];
  return candidates
    .filter((entry): entry is [number, string] => entry[0] !== undefined && entry[0] > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([, label]) => label);
}

function appendTrajectoryPairs(lines: string[], pairs: TrajectoryPairSummary[]): void {
  lines.push("## Success/failure trajectory pairs", "");
  if (!pairs.length) {
    lines.push("No task/model has both a successful and failed trial.", "");
    return;
  }
  lines.push("| Model | Task | Trials (success/failure) | Actionable contrast |", "|---|---|---|---|");
  for (const pair of pairs) {
    lines.push(
      `| ${pair.model} | ${pair.taskId} | ${pair.successTrial}/${pair.failureTrial} | ` +
        `${pair.insights.length ? pair.insights.join("; ") : "no measured structural difference"} |`,
    );
  }
  lines.push("");
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function sampleVariance(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function wilsonInterval(passed: number, total: number): ConfidenceInterval {
  if (total === 0) return { lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const rate = passed / total;
  const denominator = 1 + (z * z) / total;
  const center = (rate + (z * z) / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function averageMetric(
  results: TaskResult[],
  key: keyof TaskResult["metrics"],
): number | undefined {
  const values = results
    .map((result) => result.metrics[key])
    .filter((value): value is number => typeof value === "number");
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function trajectoryCoverage(results: TaskResult[], agent: string): number {
  const matching = results.filter((result) => result.agentName === agent);
  return matching.length
    ? (matching.filter((result) => result.metrics.trajectoryAvailable === true).length / matching.length) * 100
    : 0;
}

function formatConfidence(interval: ConfidenceInterval): string {
  return `${(interval.lower * 100).toFixed(1)}–${(interval.upper * 100).toFixed(1)}%`;
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatSecondsPair(p50: number | undefined, p95: number | undefined): string {
  return p50 === undefined || p95 === undefined ? "—" : `${p50.toFixed(1)}s / ${p95.toFixed(1)}s`;
}

function formatAveragePair(first: number | undefined, second: number | undefined): string {
  return first === undefined || second === undefined ? "—" : `${first.toFixed(1)} / ${second.toFixed(1)}`;
}
