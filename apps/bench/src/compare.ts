import type { RunReport, TaskResult } from "./types.js";
import {
  buildTrajectoryPairs,
  computeTrialStatistics,
  summarize,
  type ConfidenceInterval,
} from "./report.js";
import { isInfrastructureFailure } from "./verdict.js";

interface Percentiles {
  p50: number;
  p95: number;
}

interface MetricTotals {
  passRate: number;
  correctionPassRate: number;
  passed: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** cacheRead / (cacheRead + input) when denominator > 0. */
  cacheReadRate: number | undefined;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  estimatedCostUsd: number;
  wallTimeMs: number;
  telemetryCoverage: number;
  infrastructureErrorRate: number;
  trajectoryCoverage: number;
  timeToFirstEditMs: Percentiles | undefined;
  wallTimeDistributionMs: Percentiles;
  readOnlyTurns: number;
  rereads: number;
  errorCategories: Record<string, number>;
  compactions: number;
  verifications: number;
  delegations: number;
  costPerSuccessUsd: number | undefined;
  passAt3: number | undefined;
  passPow3: number | undefined;
  interTrialVariance: number | undefined;
  confidence95: ConfidenceInterval;
}

interface TaskDelta {
  taskId: string;
  baselinePassRate: number;
  afterPassRate: number;
  /** after - baseline (positive = improvement). */
  delta: number;
}

interface ComparisonCoverage {
  onlyBaseline: string[];
  onlyAfter: string[];
  trialCountMismatches: Array<{ taskId: string; baseline: number; after: number }>;
  agentMismatch?: { baseline: string[]; after: string[] };
  comparable: boolean;
}

interface CompareResult {
  baseline: MetricTotals;
  after: MetricTotals;
  deltas: {
    passRate: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheReadRate: number | undefined;
    turns: number;
    toolErrors: number;
    estimatedCostUsd: number;
    wallTimeMs: number;
    timeToFirstEditP50Ms: number | undefined;
    timeToFirstEditP95Ms: number | undefined;
    wallTimeP50Ms: number;
    wallTimeP95Ms: number;
    readOnlyTurns: number;
    rereads: number;
    compactions: number;
    verifications: number;
    delegations: number;
    costPerSuccessUsd: number | undefined;
    passAt3: number | undefined;
    passPow3: number | undefined;
    interTrialVariance: number | undefined;
  };
  perTask: TaskDelta[];
  coverage: ComparisonCoverage;
  ablation: {
    baseline?: string;
    after?: string;
    changedComponents: string[];
  };
}

export interface CompareThresholds {
  minPassRate?: number;
  maxPassRateDrop?: number;
  maxCostIncreasePercent?: number;
  maxWallTimeIncreasePercent?: number;
  maxP95LatencyIncreasePercent?: number;
  maxToolErrorsIncrease?: number;
  minTelemetryCoverage?: number;
  maxInfrastructureErrorRate?: number;
  minPassAt3?: number;
  minPassPow3?: number;
  maxInterTrialVariance?: number;
  minConfidenceLowerBound?: number;
  requireComparable?: boolean;
  requireSingleAblation?: boolean;
}

interface GateEvaluation {
  passed: boolean;
  failures: string[];
}

function sumMetric(results: TaskResult[], key: keyof TaskResult["metrics"]): number {
  return results.reduce((acc, r) => acc + (Number(r.metrics[key]) || 0), 0);
}

function numericMetrics(
  results: TaskResult[],
  key: keyof TaskResult["metrics"],
): number[] {
  return results
    .map((result) => result.metrics[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function distribution(values: number[]): Percentiles {
  if (!values.length) return { p50: 0, p95: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95) };
}

function quantile(sorted: number[], percentile: number): number {
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function aggregateErrorCategories(results: TaskResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const [category, count] of Object.entries(result.metrics.errorCategories ?? {})) {
      counts[category] = (counts[category] ?? 0) + count;
    }
  }
  return counts;
}

function optionalDifference(
  baseline: number | undefined,
  after: number | undefined,
): number | undefined {
  return baseline === undefined || after === undefined ? undefined : after - baseline;
}

export function totals(report: RunReport): MetricTotals {
  const results = report.results;
  const passed = results.filter((r) => r.passed).length;
  const infrastructureErrors = results.filter((result) =>
    isInfrastructureFailure(result.failureKind),
  ).length;
  const evaluable = results.length - infrastructureErrors;
  const inputTokens = sumMetric(results, "inputTokens");
  const cacheReadTokens = sumMetric(results, "cacheReadTokens");
  const denom = cacheReadTokens + inputTokens;
  const trialStatistics = computeTrialStatistics(results);
  const firstEditTimes = numericMetrics(results, "timeToFirstEditMs");
  const totalCost = sumMetric(results, "estimatedCostUsd");
  return {
    passRate: results.length ? passed / results.length : 0,
    correctionPassRate: evaluable ? passed / evaluable : 0,
    passed,
    total: results.length,
    inputTokens,
    outputTokens: sumMetric(results, "outputTokens"),
    cacheReadTokens,
    cacheWriteTokens: sumMetric(results, "cacheWriteTokens"),
    cacheReadRate: denom > 0 ? cacheReadTokens / denom : undefined,
    turns: sumMetric(results, "turns"),
    toolCalls: sumMetric(results, "toolCalls"),
    toolErrors: sumMetric(results, "toolErrors"),
    estimatedCostUsd: totalCost,
    wallTimeMs: sumMetric(results, "wallTimeMs"),
    telemetryCoverage: results.length
      ? results.filter((result) => result.metrics.telemetryAvailable === true).length /
        results.length
      : 0,
    infrastructureErrorRate: results.length
      ? infrastructureErrors / results.length
      : 0,
    trajectoryCoverage: results.length
      ? results.filter((result) => result.metrics.trajectoryAvailable === true).length / results.length
      : 0,
    timeToFirstEditMs: firstEditTimes.length ? distribution(firstEditTimes) : undefined,
    wallTimeDistributionMs: distribution(results.map((result) => result.metrics.wallTimeMs)),
    readOnlyTurns: sumMetric(results, "readOnlyTurns"),
    rereads: sumMetric(results, "rereads"),
    errorCategories: aggregateErrorCategories(results),
    compactions: sumMetric(results, "compactions"),
    verifications: sumMetric(results, "verifications"),
    delegations: sumMetric(results, "delegations"),
    costPerSuccessUsd: passed > 0 ? totalCost / passed : undefined,
    passAt3: trialStatistics.passAt3,
    passPow3: trialStatistics.passPow3,
    interTrialVariance: trialStatistics.interTrialVariance,
    confidence95: trialStatistics.confidence95,
  };
}

function passRateByTask(report: RunReport): Map<string, number> {
  const byTask = new Map<string, { passed: number; total: number }>();
  for (const r of report.results) {
    const cur = byTask.get(r.taskId) ?? { passed: 0, total: 0 };
    cur.total += 1;
    if (r.passed) cur.passed += 1;
    byTask.set(r.taskId, cur);
  }
  const rates = new Map<string, number>();
  for (const [id, { passed, total }] of byTask) {
    rates.set(id, total ? passed / total : 0);
  }
  return rates;
}

function countByTask(report: RunReport): Map<string, number> {
  const counts = new Map<string, number>();
  for (const result of report.results) {
    counts.set(result.taskId, (counts.get(result.taskId) ?? 0) + 1);
  }
  return counts;
}

function comparisonCoverage(baseline: RunReport, after: RunReport): ComparisonCoverage {
  const baselineCounts = countByTask(baseline);
  const afterCounts = countByTask(after);
  const onlyBaseline = [...baselineCounts.keys()].filter((id) => !afterCounts.has(id)).sort();
  const onlyAfter = [...afterCounts.keys()].filter((id) => !baselineCounts.has(id)).sort();
  const trialCountMismatches = [...baselineCounts.entries()]
    .filter(([taskId, count]) => afterCounts.has(taskId) && afterCounts.get(taskId) !== count)
    .map(([taskId, count]) => ({ taskId, baseline: count, after: afterCounts.get(taskId) ?? 0 }))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
  const baselineAgents = [...new Set(baseline.agents)].sort();
  const afterAgents = [...new Set(after.agents)].sort();
  const agentMismatch =
    JSON.stringify(baselineAgents) === JSON.stringify(afterAgents)
      ? undefined
      : { baseline: baselineAgents, after: afterAgents };
  return {
    onlyBaseline,
    onlyAfter,
    trialCountMismatches,
    agentMismatch,
    comparable:
      onlyBaseline.length === 0 &&
      onlyAfter.length === 0 &&
      trialCountMismatches.length === 0 &&
      agentMismatch === undefined,
  };
}

/** Pure comparison of two RunReport objects. */
export function compareReports(baseline: RunReport, after: RunReport): CompareResult {
  const b = totals(baseline);
  const a = totals(after);
  const baseRates = passRateByTask(baseline);
  const afterRates = passRateByTask(after);
  const taskIds = [...baseRates.keys()].filter((taskId) => afterRates.has(taskId));
  const perTask: TaskDelta[] = [...taskIds]
    .sort()
    .map((taskId) => {
      const baselinePassRate = baseRates.get(taskId) ?? 0;
      const afterPassRate = afterRates.get(taskId) ?? 0;
      return { taskId, baselinePassRate, afterPassRate, delta: afterPassRate - baselinePassRate };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.taskId.localeCompare(y.taskId));

  const cacheDelta =
    a.cacheReadRate !== undefined && b.cacheReadRate !== undefined
      ? a.cacheReadRate - b.cacheReadRate
      : undefined;

  return {
    baseline: b,
    after: a,
    deltas: {
      passRate: a.passRate - b.passRate,
      inputTokens: a.inputTokens - b.inputTokens,
      outputTokens: a.outputTokens - b.outputTokens,
      cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
      cacheReadRate: cacheDelta,
      turns: a.turns - b.turns,
      toolErrors: a.toolErrors - b.toolErrors,
      estimatedCostUsd: a.estimatedCostUsd - b.estimatedCostUsd,
      wallTimeMs: a.wallTimeMs - b.wallTimeMs,
      timeToFirstEditP50Ms: optionalDifference(b.timeToFirstEditMs?.p50, a.timeToFirstEditMs?.p50),
      timeToFirstEditP95Ms: optionalDifference(b.timeToFirstEditMs?.p95, a.timeToFirstEditMs?.p95),
      wallTimeP50Ms: a.wallTimeDistributionMs.p50 - b.wallTimeDistributionMs.p50,
      wallTimeP95Ms: a.wallTimeDistributionMs.p95 - b.wallTimeDistributionMs.p95,
      readOnlyTurns: a.readOnlyTurns - b.readOnlyTurns,
      rereads: a.rereads - b.rereads,
      compactions: a.compactions - b.compactions,
      verifications: a.verifications - b.verifications,
      delegations: a.delegations - b.delegations,
      costPerSuccessUsd: optionalDifference(b.costPerSuccessUsd, a.costPerSuccessUsd),
      passAt3: optionalDifference(b.passAt3, a.passAt3),
      passPow3: optionalDifference(b.passPow3, a.passPow3),
      interTrialVariance: optionalDifference(b.interTrialVariance, a.interTrialVariance),
    },
    perTask,
    coverage: comparisonCoverage(baseline, after),
    ablation: {
      baseline: baseline.manifest?.ablation?.name,
      after: after.manifest?.ablation?.name,
      changedComponents: changedAblationComponents(baseline, after),
    },
  };
}

function changedAblationComponents(baseline: RunReport, after: RunReport): string[] {
  const before = baseline.manifest?.ablation?.components;
  const current = after.manifest?.ablation?.components;
  if (!before || !current) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(current)])]
    .filter((component) => before[component] !== current[component])
    .sort();
}

function percentIncrease(after: number, baseline: number): number {
  if (baseline === 0) return after > 0 ? Number.POSITIVE_INFINITY : 0;
  return ((after - baseline) / baseline) * 100;
}

/** Evaluate deterministic CI gates. Threshold rates use 0..1; increases use percentages. */
export function evaluateCompareGates(
  comparison: CompareResult,
  thresholds: CompareThresholds,
): GateEvaluation {
  const failures: string[] = [];
  if ((thresholds.requireComparable ?? true) && !comparison.coverage.comparable) {
    failures.push("agents, task coverage, or trial counts differ");
  }
  if (
    thresholds.minPassRate !== undefined &&
    comparison.after.passRate < thresholds.minPassRate
  ) {
    failures.push(
      `pass rate ${(comparison.after.passRate * 100).toFixed(1)}% is below ` +
        `${(thresholds.minPassRate * 100).toFixed(1)}%`,
    );
  }
  if (thresholds.minPassAt3 !== undefined) {
    if (comparison.after.passAt3 === undefined) {
      failures.push("pass@3 is unavailable (three trials per task are required)");
    } else if (comparison.after.passAt3 < thresholds.minPassAt3) {
      failures.push(
        `pass@3 ${(comparison.after.passAt3 * 100).toFixed(1)}% is below ` +
          `${(thresholds.minPassAt3 * 100).toFixed(1)}%`,
      );
    }
  }
  if (thresholds.minPassPow3 !== undefined) {
    if (comparison.after.passPow3 === undefined) {
      failures.push("pass^3 is unavailable (three trials per task are required)");
    } else if (comparison.after.passPow3 < thresholds.minPassPow3) {
      failures.push(
        `pass^3 ${(comparison.after.passPow3 * 100).toFixed(1)}% is below ` +
          `${(thresholds.minPassPow3 * 100).toFixed(1)}%`,
      );
    }
  }
  if (thresholds.maxInterTrialVariance !== undefined) {
    if (comparison.after.interTrialVariance === undefined) {
      failures.push("inter-trial variance is unavailable (multiple trials are required)");
    } else if (comparison.after.interTrialVariance > thresholds.maxInterTrialVariance) {
      failures.push(
        `inter-trial variance ${comparison.after.interTrialVariance.toFixed(4)} exceeds ` +
          thresholds.maxInterTrialVariance.toFixed(4),
      );
    }
  }
  if (
    thresholds.minConfidenceLowerBound !== undefined &&
    comparison.after.confidence95.lower < thresholds.minConfidenceLowerBound
  ) {
    failures.push(
      `95% confidence lower bound ${(comparison.after.confidence95.lower * 100).toFixed(1)}% is below ` +
        `${(thresholds.minConfidenceLowerBound * 100).toFixed(1)}%`,
    );
  }
  if (
    thresholds.minTelemetryCoverage !== undefined &&
    comparison.after.telemetryCoverage < thresholds.minTelemetryCoverage
  ) {
    failures.push(
      `telemetry coverage ${(comparison.after.telemetryCoverage * 100).toFixed(1)}% is below ` +
        `${(thresholds.minTelemetryCoverage * 100).toFixed(1)}%`,
    );
  }
  if (
    thresholds.maxInfrastructureErrorRate !== undefined &&
    comparison.after.infrastructureErrorRate >
      thresholds.maxInfrastructureErrorRate
  ) {
    failures.push(
      `infrastructure error rate ${(comparison.after.infrastructureErrorRate * 100).toFixed(1)}% exceeds ` +
        `${(thresholds.maxInfrastructureErrorRate * 100).toFixed(1)}%`,
    );
  }
  if (
    thresholds.maxPassRateDrop !== undefined &&
    comparison.deltas.passRate < -thresholds.maxPassRateDrop
  ) {
    failures.push(
      `pass rate dropped ${(-comparison.deltas.passRate * 100).toFixed(1)}pp ` +
        `(limit ${(thresholds.maxPassRateDrop * 100).toFixed(1)}pp)`,
    );
  }
  const costIncrease = percentIncrease(
    comparison.after.estimatedCostUsd,
    comparison.baseline.estimatedCostUsd,
  );
  if (
    thresholds.maxCostIncreasePercent !== undefined &&
    costIncrease > thresholds.maxCostIncreasePercent
  ) {
    failures.push(
      `cost increased ${Number.isFinite(costIncrease) ? `${costIncrease.toFixed(1)}%` : "from zero"} ` +
        `(limit ${thresholds.maxCostIncreasePercent.toFixed(1)}%)`,
    );
  }
  const wallIncrease = percentIncrease(comparison.after.wallTimeMs, comparison.baseline.wallTimeMs);
  if (
    thresholds.maxWallTimeIncreasePercent !== undefined &&
    wallIncrease > thresholds.maxWallTimeIncreasePercent
  ) {
    failures.push(
      `wall time increased ${wallIncrease.toFixed(1)}% ` +
        `(limit ${thresholds.maxWallTimeIncreasePercent.toFixed(1)}%)`,
    );
  }
  const p95Increase = percentIncrease(
    comparison.after.wallTimeDistributionMs.p95,
    comparison.baseline.wallTimeDistributionMs.p95,
  );
  if (
    thresholds.maxP95LatencyIncreasePercent !== undefined &&
    p95Increase > thresholds.maxP95LatencyIncreasePercent
  ) {
    failures.push(
      `p95 latency increased ${p95Increase.toFixed(1)}% ` +
        `(limit ${thresholds.maxP95LatencyIncreasePercent.toFixed(1)}%)`,
    );
  }
  if (
    thresholds.requireSingleAblation &&
    comparison.ablation.changedComponents.length !== 1
  ) {
    failures.push(
      `expected exactly one changed ablation component; found ` +
        `${comparison.ablation.changedComponents.length}`,
    );
  }
  if (
    thresholds.maxToolErrorsIncrease !== undefined &&
    comparison.deltas.toolErrors > thresholds.maxToolErrorsIncrease
  ) {
    failures.push(
      `tool errors increased by ${comparison.deltas.toolErrors} ` +
        `(limit ${thresholds.maxToolErrorsIncrease})`,
    );
  }
  return { passed: failures.length === 0, failures };
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtOptionalPct(value: number | undefined): string {
  return value === undefined ? "—" : fmtPct(value);
}

function fmtOptionalRateDelta(value: number | undefined): string {
  return value === undefined ? "—" : fmtDelta(value * 100, "%");
}

function fmtOptionalNumber(value: number | undefined, digits: number): string {
  if (value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function fmtConfidence(value: ConfidenceInterval): string {
  return `${fmtPct(value.lower)}–${fmtPct(value.upper)}`;
}

function fmtDistribution(value: Percentiles | undefined): string {
  return value ? `${(value.p50 / 1000).toFixed(1)}s / ${(value.p95 / 1000).toFixed(1)}s` : "—";
}

function fmtOptionalMilliseconds(value: number | undefined): string {
  return value === undefined ? "—" : fmtDelta(value / 1000, "s");
}

function fmtOptionalCost(value: number | undefined): string {
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

function fmtOptionalCostDelta(value: number | undefined): string {
  return value === undefined ? "—" : fmtDelta(value, "$");
}

function fmtCategories(categories: Record<string, number>): string {
  const entries = Object.entries(categories).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries.length ? entries.map(([category, count]) => `${category}: ${count}`).join(", ") : "—";
}

function fmtDelta(n: number, unit = ""): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (unit === "%") return `${sign}${abs.toFixed(1)}pp`;
  if (unit === "$") return `${sign}$${abs.toFixed(4)}`;
  if (unit === "s") return `${sign}${abs.toFixed(1)}s`;
  return `${sign}${abs.toFixed(0)}`;
}

function arrow(delta: number): string {
  if (delta > 0) return "↑";
  if (delta < 0) return "↓";
  return "→";
}

function appendCoverageWarning(lines: string[], coverage: ComparisonCoverage): void {
  if (coverage.comparable) return;
  lines.push(
    "- ⚠️ Coverage differs; overall totals are shown but must not be treated as a controlled regression.",
  );
  if (coverage.onlyBaseline.length) {
    lines.push(`  - Baseline only: ${coverage.onlyBaseline.join(", ")}`);
  }
  if (coverage.onlyAfter.length) {
    lines.push(`  - After only: ${coverage.onlyAfter.join(", ")}`);
  }
  if (coverage.trialCountMismatches.length) {
    const mismatches = coverage.trialCountMismatches
      .map((item) => `${item.taskId} ${item.baseline}→${item.after}`)
      .join(", ");
    lines.push(`  - Trial-count mismatch: ${mismatches}`);
  }
  if (coverage.agentMismatch) {
    lines.push(
      `  - Agent mismatch: ${coverage.agentMismatch.baseline.join(", ")} → ` +
        coverage.agentMismatch.after.join(", "),
    );
  }
}

function appendAgentSummary(lines: string[], baseline: RunReport, after: RunReport): void {
  const baseSum = summarize(baseline);
  const afterSum = summarize(after);
  if (baseSum.length <= 1 && afterSum.length <= 1) return;
  lines.push("## Agents", "");
  lines.push(`- Baseline agents: ${baseSum.map((s) => `${s.agent} ${fmtPct(s.passRate)}`).join(", ")}`);
  lines.push(`- After agents: ${afterSum.map((s) => `${s.agent} ${fmtPct(s.passRate)}`).join(", ")}`);
  lines.push("");
}

function appendPairComparison(lines: string[], baseline: RunReport, after: RunReport): void {
  const baselinePairs = buildTrajectoryPairs(baseline);
  const afterPairs = buildTrajectoryPairs(after);
  lines.push("## Success/failure trajectory pairs", "");
  lines.push(`- Baseline: ${baselinePairs.length} paired task/model contrast(s)`);
  lines.push(`- After: ${afterPairs.length} paired task/model contrast(s)`);
  const actionable = afterPairs
    .filter((pair) => pair.insights.length)
    .slice(0, 10)
    .map((pair) => `${pair.model}/${pair.taskId}: ${pair.insights.join("; ")}`);
  if (actionable.length) lines.push(...actionable.map((line) => `- ${line}`));
  lines.push("");
}

export function compareToMarkdown(baseline: RunReport, after: RunReport): string {
  const c = compareReports(baseline, after);
  const lines: string[] = [];
  lines.push("# NinjaBench compare");
  lines.push("");
  lines.push(`- Baseline: ${baseline.startedAt}${baseline.gitCommit ? ` (\`${baseline.gitCommit}\`)` : ""}`);
  lines.push(`- After: ${after.startedAt}${after.gitCommit ? ` (\`${after.gitCommit}\`)` : ""}`);
  if (c.ablation.baseline || c.ablation.after) {
    lines.push(
      `- Ablation: ${c.ablation.baseline ?? "unspecified"} → ` +
        `${c.ablation.after ?? "unspecified"}; changed: ` +
        `${c.ablation.changedComponents.join(", ") || "none"}`,
    );
  }
  appendCoverageWarning(lines, c.coverage);
  lines.push("");
  lines.push("## Overall");
  lines.push("");
  lines.push("| Metric | Baseline | After | Delta |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| Pass rate | ${fmtPct(c.baseline.passRate)} (${c.baseline.passed}/${c.baseline.total}) | ` +
      `${fmtPct(c.after.passRate)} (${c.after.passed}/${c.after.total}) | ` +
      `${arrow(c.deltas.passRate)} ${fmtDelta(c.deltas.passRate * 100, "%")} |`,
  );
  lines.push(
    `| Correction pass rate | ${fmtPct(c.baseline.correctionPassRate)} | ` +
      `${fmtPct(c.after.correctionPassRate)} | — |`,
  );
  lines.push(
    `| pass@3 | ${fmtOptionalPct(c.baseline.passAt3)} | ${fmtOptionalPct(c.after.passAt3)} | ` +
      `${fmtOptionalRateDelta(c.deltas.passAt3)} |`,
  );
  lines.push(
    `| pass^3 | ${fmtOptionalPct(c.baseline.passPow3)} | ${fmtOptionalPct(c.after.passPow3)} | ` +
      `${fmtOptionalRateDelta(c.deltas.passPow3)} |`,
  );
  lines.push(
    `| Inter-trial variance | ${fmtOptionalNumber(c.baseline.interTrialVariance, 4)} | ` +
      `${fmtOptionalNumber(c.after.interTrialVariance, 4)} | ` +
      `${fmtOptionalNumber(c.deltas.interTrialVariance, 4)} |`,
  );
  lines.push(
    `| Pass rate 95% CI | ${fmtConfidence(c.baseline.confidence95)} | ` +
      `${fmtConfidence(c.after.confidence95)} | — |`,
  );
  lines.push(
    `| Telemetry coverage | ${fmtPct(c.baseline.telemetryCoverage)} | ` +
      `${fmtPct(c.after.telemetryCoverage)} | — |`,
  );
  lines.push(
    `| Trajectory coverage | ${fmtPct(c.baseline.trajectoryCoverage)} | ` +
      `${fmtPct(c.after.trajectoryCoverage)} | — |`,
  );
  lines.push(
    `| Infrastructure errors | ${fmtPct(c.baseline.infrastructureErrorRate)} | ` +
      `${fmtPct(c.after.infrastructureErrorRate)} | — |`,
  );
  lines.push(
    `| Input tokens | ${c.baseline.inputTokens} | ${c.after.inputTokens} | ${arrow(-c.deltas.inputTokens)} ${fmtDelta(c.deltas.inputTokens)} |`,
  );
  lines.push(
    `| Output tokens | ${c.baseline.outputTokens} | ${c.after.outputTokens} | ${fmtDelta(c.deltas.outputTokens)} |`,
  );
  const bCache = c.baseline.cacheReadRate !== undefined ? fmtPct(c.baseline.cacheReadRate) : "—";
  const aCache = c.after.cacheReadRate !== undefined ? fmtPct(c.after.cacheReadRate) : "—";
  const dCache =
    c.deltas.cacheReadRate !== undefined
      ? `${arrow(c.deltas.cacheReadRate)} ${fmtDelta(c.deltas.cacheReadRate * 100, "%")}`
      : "—";
  lines.push(`| Cache read rate | ${bCache} | ${aCache} | ${dCache} |`);
  lines.push(`| Turns | ${c.baseline.turns} | ${c.after.turns} | ${fmtDelta(c.deltas.turns)} |`);
  lines.push(
    `| First edit p50/p95 | ${fmtDistribution(c.baseline.timeToFirstEditMs)} | ` +
      `${fmtDistribution(c.after.timeToFirstEditMs)} | ` +
      `${fmtOptionalMilliseconds(c.deltas.timeToFirstEditP50Ms)} / ` +
      `${fmtOptionalMilliseconds(c.deltas.timeToFirstEditP95Ms)} |`,
  );
  lines.push(
    `| Wall time p50/p95 | ${fmtDistribution(c.baseline.wallTimeDistributionMs)} | ` +
      `${fmtDistribution(c.after.wallTimeDistributionMs)} | ` +
      `${fmtDelta(c.deltas.wallTimeP50Ms / 1000, "s")} / ${fmtDelta(c.deltas.wallTimeP95Ms / 1000, "s")} |`,
  );
  lines.push(
    `| Read-only turns / rereads | ${c.baseline.readOnlyTurns} / ${c.baseline.rereads} | ` +
      `${c.after.readOnlyTurns} / ${c.after.rereads} | ` +
      `${fmtDelta(c.deltas.readOnlyTurns)} / ${fmtDelta(c.deltas.rereads)} |`,
  );
  lines.push(
    `| Compactions / verifications / delegations | ${c.baseline.compactions} / ${c.baseline.verifications} / ${c.baseline.delegations} | ` +
      `${c.after.compactions} / ${c.after.verifications} / ${c.after.delegations} | ` +
      `${fmtDelta(c.deltas.compactions)} / ${fmtDelta(c.deltas.verifications)} / ${fmtDelta(c.deltas.delegations)} |`,
  );
  lines.push(
    `| Tool errors | ${c.baseline.toolErrors} | ${c.after.toolErrors} | ${arrow(-c.deltas.toolErrors)} ${fmtDelta(c.deltas.toolErrors)} |`,
  );
  lines.push(
    `| Cost | $${c.baseline.estimatedCostUsd.toFixed(4)} | $${c.after.estimatedCostUsd.toFixed(4)} | ${arrow(-c.deltas.estimatedCostUsd)} ${fmtDelta(c.deltas.estimatedCostUsd, "$")} |`,
  );
  lines.push(
    `| Cost per success | ${fmtOptionalCost(c.baseline.costPerSuccessUsd)} | ` +
      `${fmtOptionalCost(c.after.costPerSuccessUsd)} | ${fmtOptionalCostDelta(c.deltas.costPerSuccessUsd)} |`,
  );
  lines.push(
    `| Error categories | ${fmtCategories(c.baseline.errorCategories)} | ` +
      `${fmtCategories(c.after.errorCategories)} | — |`,
  );
  lines.push(
    `| Wall time (sum) | ${(c.baseline.wallTimeMs / 1000).toFixed(1)}s | ${(c.after.wallTimeMs / 1000).toFixed(1)}s | ${fmtDelta(c.deltas.wallTimeMs / 1000, "s")} |`,
  );
  lines.push("");
  lines.push("## Per-task pass rate");
  lines.push("");
  lines.push("| Task | Baseline | After | Delta |");
  lines.push("|---|---|---|---|");
  for (const t of c.perTask) {
    lines.push(
      `| ${t.taskId} | ${fmtPct(t.baselinePassRate)} | ${fmtPct(t.afterPassRate)} | ` +
        `${arrow(t.delta)} ${fmtDelta(t.delta * 100, "%")} |`,
    );
  }
  lines.push("");
  appendPairComparison(lines, baseline, after);
  appendAgentSummary(lines, baseline, after);
  return lines.join("\n");
}
