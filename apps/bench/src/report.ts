import type { RunReport, TaskResult } from "./types.js";

interface AgentSummary {
  agent: string;
  passRate: number;
  passed: number;
  total: number;
  avgWallTimeSec: number;
  totalCostUsd?: number;
  avgTurns?: number;
  toolErrorRate?: number;
  passAtK?: number;
  passPowK?: number;
  passStdDev?: number;
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
    const costs = results.map((r) => r.metrics.estimatedCostUsd).filter((c): c is number => c !== undefined);
    const turns = results.map((r) => r.metrics.turns).filter((t): t is number => t !== undefined);
    const toolCalls = results.reduce((acc, r) => acc + (r.metrics.toolCalls ?? 0), 0);
    const toolErrors = results.reduce((acc, r) => acc + (r.metrics.toolErrors ?? 0), 0);
    const passStats = computePassAtK(results);
    summaries.push({
      agent,
      passed,
      total: results.length,
      passRate: results.length ? passed / results.length : 0,
      avgWallTimeSec:
        results.reduce((acc, r) => acc + r.metrics.wallTimeMs, 0) / Math.max(results.length, 1) / 1000,
      totalCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
      avgTurns: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : undefined,
      toolErrorRate: toolCalls ? toolErrors / toolCalls : undefined,
      passAtK: passStats.passAtK,
      passPowK: passStats.passPowK,
      passStdDev: passStats.stdDev,
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
  lines.push(`| Agent | Pass rate | pass@k | pass^k | σ | Avg time (s) | Total cost | Avg turns | Tool error rate |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const s of summaries) {
    lines.push(
      `| ${s.agent} | ${(s.passRate * 100).toFixed(1)}% (${s.passed}/${s.total}) | ` +
        `${s.passAtK !== undefined ? `${(s.passAtK * 100).toFixed(1)}%` : "—"} | ` +
        `${s.passPowK !== undefined ? `${(s.passPowK * 100).toFixed(1)}%` : "—"} | ` +
        `${s.passStdDev !== undefined ? s.passStdDev.toFixed(3) : "—"} | ${s.avgWallTimeSec.toFixed(1)} | ` +
        `${s.totalCostUsd !== undefined ? `$${s.totalCostUsd.toFixed(4)}` : "—"} | ` +
        `${s.avgTurns !== undefined ? s.avgTurns.toFixed(1) : "—"} | ` +
        `${s.toolErrorRate !== undefined ? `${(s.toolErrorRate * 100).toFixed(1)}%` : "—"} |`,
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
