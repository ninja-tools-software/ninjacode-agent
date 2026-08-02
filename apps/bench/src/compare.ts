import type { RunReport, TaskResult } from "./types.js";
import { summarize } from "./report.js";

export interface MetricTotals {
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

export interface TaskDelta {
  taskId: string;
  baselinePassRate: number;
  afterPassRate: number;
  /** after - baseline (positive = improvement). */
  delta: number;
}

export interface CompareResult {
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

/** Pure comparison of two RunReport objects. */
export function compareReports(baseline: RunReport, after: RunReport): CompareResult {
  const b = totals(baseline);
  const a = totals(after);
  const baseRates = passRateByTask(baseline);
  const afterRates = passRateByTask(after);
  const taskIds = new Set([...baseRates.keys(), ...afterRates.keys()]);
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
  };
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

export function compareToMarkdown(baseline: RunReport, after: RunReport): string {
  const c = compareReports(baseline, after);
  const lines: string[] = [];
  lines.push("# NinjaBench compare");
  lines.push("");
  lines.push(`- Baseline: ${baseline.startedAt}${baseline.gitCommit ? ` (\`${baseline.gitCommit}\`)` : ""}`);
  lines.push(`- After: ${after.startedAt}${after.gitCommit ? ` (\`${after.gitCommit}\`)` : ""}`);
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

  // Include agent-level summaries for context when multi-agent.
  const baseSum = summarize(baseline);
  const afterSum = summarize(after);
  if (baseSum.length > 1 || afterSum.length > 1) {
    lines.push("## Agents");
    lines.push("");
    lines.push(`- Baseline agents: ${baseSum.map((s) => `${s.agent} ${fmtPct(s.passRate)}`).join(", ")}`);
    lines.push(`- After agents: ${afterSum.map((s) => `${s.agent} ${fmtPct(s.passRate)}`).join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}
