import type { RunReport, TaskResult } from "./types.js";
import { summarize } from "./report.js";

interface MetricTotals {
  passRate: number;
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
  };
  perTask: TaskDelta[];
  coverage: ComparisonCoverage;
}

export interface CompareThresholds {
  minPassRate?: number;
  maxPassRateDrop?: number;
  maxCostIncreasePercent?: number;
  maxWallTimeIncreasePercent?: number;
  maxToolErrorsIncrease?: number;
  requireComparable?: boolean;
}

interface GateEvaluation {
  passed: boolean;
  failures: string[];
}

function sumMetric(results: TaskResult[], key: keyof TaskResult["metrics"]): number {
  return results.reduce((acc, r) => acc + (Number(r.metrics[key]) || 0), 0);
}

export function totals(report: RunReport): MetricTotals {
  const results = report.results;
  const passed = results.filter((r) => r.passed).length;
  const inputTokens = sumMetric(results, "inputTokens");
  const cacheReadTokens = sumMetric(results, "cacheReadTokens");
  const denom = cacheReadTokens + inputTokens;
  return {
    passRate: results.length ? passed / results.length : 0,
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
    estimatedCostUsd: sumMetric(results, "estimatedCostUsd"),
    wallTimeMs: sumMetric(results, "wallTimeMs"),
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
    },
    perTask,
    coverage: comparisonCoverage(baseline, after),
  };
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

export function compareToMarkdown(baseline: RunReport, after: RunReport): string {
  const c = compareReports(baseline, after);
  const lines: string[] = [];
  lines.push("# NinjaBench compare");
  lines.push("");
  lines.push(`- Baseline: ${baseline.startedAt}${baseline.gitCommit ? ` (\`${baseline.gitCommit}\`)` : ""}`);
  lines.push(`- After: ${after.startedAt}${after.gitCommit ? ` (\`${after.gitCommit}\`)` : ""}`);
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
    `| Tool errors | ${c.baseline.toolErrors} | ${c.after.toolErrors} | ${arrow(-c.deltas.toolErrors)} ${fmtDelta(c.deltas.toolErrors)} |`,
  );
  lines.push(
    `| Cost | $${c.baseline.estimatedCostUsd.toFixed(4)} | $${c.after.estimatedCostUsd.toFixed(4)} | ${arrow(-c.deltas.estimatedCostUsd)} ${fmtDelta(c.deltas.estimatedCostUsd, "$")} |`,
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
  appendAgentSummary(lines, baseline, after);
  return lines.join("\n");
}
