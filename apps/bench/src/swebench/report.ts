import { countFailureCauses, diffPredictRuns } from "./telemetry.js";
import type { CompareRow, EvalRunMeta, PredictDeltaRow, PredictRunMeta } from "./types.js";

export function compareEvalRuns(evals: EvalRunMeta[]): CompareRow[] {
  return evals
    .map((e) => ({
      agent: pathBasename(e.predictionsPath).replace(/\.jsonl$/, ""),
      modelNameOrPath: pathBasename(e.predictionsPath).replace(/\.jsonl$/, ""),
      resolved: e.resolvedCount,
      total: e.total,
      passRate: e.passRate,
      runId: e.runId,
      reportPath: e.reportPath,
      predictionsPath: e.predictionsPath,
    }))
    .sort((a, b) => b.passRate - a.passRate);
}

function pathBasename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] ?? p;
}

export function toCompareMarkdown(rows: CompareRow[], evals: EvalRunMeta[]): string {
  const lines: string[] = [];
  lines.push("# SWE-bench Lite comparison");
  lines.push("");
  if (evals[0]) {
    lines.push(`- Dataset: \`${evals[0].dataset}\``);
    lines.push(`- Compared runs: ${evals.length}`);
  }
  lines.push("");
  lines.push("> Product comparison (harness + model). Pin models explicitly for fair harness-only conclusions.");
  lines.push("");
  lines.push("| Agent | Resolved | Pass rate | Run ID | Predictions |");
  lines.push("|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${row.agent} | ${row.resolved}/${row.total} | ${(row.passRate * 100).toFixed(1)}% | ${row.runId} | \`${row.predictionsPath ?? "—"}\` |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function telemetryLines(meta: PredictRunMeta): string[] {
  const t = meta.telemetry;
  if (t.instancesWithTelemetry === 0) {
    return ["- Token telemetry: unavailable (CLI adapter)"];
  }
  return [
    `- Cache read rate: ${(t.cacheReadRate * 100).toFixed(1)}%`,
    `- Tokens: ${formatTokens(t.inputTokens)} uncached in · ${formatTokens(t.outputTokens)} out · ` +
      `${formatTokens(t.cacheReadTokens)} cache read · ${formatTokens(t.cacheWriteTokens)} cache write`,
    `- Avg turns: ${t.avgTurns.toFixed(1)} · avg tool calls: ${t.avgToolCalls.toFixed(1)} · tool errors: ${t.toolErrors}`,
    t.avgCostUsd !== undefined ? `- Avg cost/instance: ~$${t.avgCostUsd.toFixed(4)}` : "",
  ].filter(Boolean);
}

/** Where the turns went, most-used tool first — reads as an exploration/edit ratio. */
function toolMixLine(meta: PredictRunMeta): string {
  const entries = Object.entries(meta.telemetry.toolHistogram).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const total = entries.reduce((acc, [, n]) => acc + n, 0);
  const top = entries
    .slice(0, 6)
    .map(([tool, n]) => `${tool} ${((n / total) * 100).toFixed(0)}%`)
    .join(" · ");
  return `- Tool mix: ${top}`;
}

function failureCauseLine(meta: PredictRunMeta): string {
  const causes = countFailureCauses(meta.instances);
  const parts = Object.entries(causes)
    .sort((a, b) => b[1] - a[1])
    .map(([cause, n]) => `${cause}=${n}`);
  return `- Outcomes: ${parts.join(" · ") || "none"}`;
}

export function predictMetaToMarkdown(metas: PredictRunMeta[]): string {
  const lines: string[] = ["# SWE-bench Lite predict run", ""];
  for (const meta of metas) {
    lines.push(`## ${meta.agentName}`, "");
    lines.push(`- Predictions: \`${meta.predictionsPath}\``);
    lines.push(`- Instances: ${meta.totalInstances}`);
    lines.push(failureCauseLine(meta));
    lines.push(
      `- Wall time: ${(meta.totalWallTimeMs / 1000).toFixed(1)}s` +
        (meta.totalCostUsd !== undefined ? ` · total cost ~$${meta.totalCostUsd.toFixed(4)}` : ""),
    );
    lines.push(...telemetryLines(meta), ...[toolMixLine(meta)].filter(Boolean));
    if (meta.gitCommit) lines.push(`- Commit: \`${meta.gitCommit}\``);
    lines.push("");
  }
  lines.push("> Pass rate requires the Docker eval: `ninjabench swebench eval --predictions <file>`.");
  lines.push("");
  return lines.join("\n");
}

function formatDeltaRow(row: PredictDeltaRow): string {
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(4));
  if (row.changeRatio === undefined) {
    return `| ${row.metric} | ${fmt(row.baseline)} | ${fmt(row.current)} | — |`;
  }
  const pct = `${row.changeRatio >= 0 ? "+" : ""}${(row.changeRatio * 100).toFixed(1)}%`;
  const improved = row.higherIsBetter ? row.changeRatio > 0 : row.changeRatio < 0;
  const marker = row.changeRatio === 0 ? "=" : improved ? "better" : "worse";
  return `| ${row.metric} | ${fmt(row.baseline)} | ${fmt(row.current)} | ${pct} (${marker}) |`;
}

/** Delta table against a previous predict run — how a harness change moved the numbers. */
export function predictDeltaToMarkdown(baseline: PredictRunMeta, current: PredictRunMeta): string {
  const rows = diffPredictRuns(baseline, current);
  return [
    `## Delta vs baseline (${baseline.agentName})`,
    "",
    `- Baseline: \`${baseline.predictionsPath}\`${baseline.gitCommit ? ` (\`${baseline.gitCommit}\`)` : ""}`,
    `- Current: \`${current.predictionsPath}\`${current.gitCommit ? ` (\`${current.gitCommit}\`)` : ""}`,
    "",
    "| Metric | Baseline | Current | Change |",
    "|---|---|---|---|",
    ...rows.map(formatDeltaRow),
    "",
  ].join("\n");
}

export function evalMetaToMarkdown(meta: EvalRunMeta): string {
  const lines: string[] = [];
  lines.push(`# SWE-bench eval: ${meta.runId}`);
  lines.push("");
  lines.push(`- Dataset: \`${meta.dataset}\``);
  lines.push(`- Predictions: \`${meta.predictionsPath}\``);
  lines.push(`- Resolved: ${meta.resolvedCount}/${meta.total} (${(meta.passRate * 100).toFixed(1)}%)`);
  lines.push(`- Report: \`${meta.reportPath}\``);
  lines.push("");
  return lines.join("\n");
}
