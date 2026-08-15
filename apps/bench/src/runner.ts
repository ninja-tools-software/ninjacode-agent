import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentAdapter, BenchTask, RunReport, TaskResult } from "./types.js";
import { computeKeepRate } from "./keepRate.js";
import { buildRunManifest, hashText } from "./manifest.js";
import { decideTaskVerdict } from "./verdict.js";
import { cleanupWorkspace, diffStats, prepareWorkspace, runShell } from "./workspace.js";

const execFileAsync = promisify(execFile);

interface RunOptions {
  trials: number;
  /** Max concurrent (agent, task, trial) runs. Default 1 (sequential). */
  concurrency?: number;
  /** Keep temp workspaces on failure for debugging. */
  keepFailures?: boolean;
  publishable?: boolean;
  provider?: string;
  model?: string;
  onProgress?: (line: string) => void;
}

interface Job {
  agent: AgentAdapter;
  task: BenchTask;
  trial: number;
}

export async function runBench(
  agents: AgentAdapter[],
  tasks: BenchTask[],
  opts: RunOptions,
): Promise<RunReport> {
  const startedAt = new Date().toISOString();
  const log = opts.onProgress ?? (() => undefined);
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  const jobs: Job[] = [];
  for (const agent of agents) {
    for (const task of tasks) {
      for (let trial = 1; trial <= opts.trials; trial++) {
        jobs.push({ agent, task, trial });
      }
    }
  }

  const results = await mapPool(jobs, concurrency, async (job) => {
    const result = await runOne(job.agent, job.task, job.trial, opts);
    log(
      `${result.passed ? "PASS" : "FAIL"}  ${job.agent.name}  ${job.task.id}  trial ${job.trial}` +
        `  (${(result.metrics.wallTimeMs / 1000).toFixed(1)}s` +
        (result.metrics.estimatedCostUsd !== undefined
          ? `, ~$${result.metrics.estimatedCostUsd.toFixed(4)}`
          : "") +
        `)${result.failureKind ? `  [${result.failureKind}]` : ""}`,
    );
    return result;
  });

  let gitCommit: string | undefined;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"]);
    gitCommit = stdout.trim();
  } catch {
    gitCommit = undefined;
  }

  const promptHash = hashText(tasks.map((task) => `${task.id}\n${task.prompt}`).join("\n---\n"));
  const rulesHash = hashText(tasks.map((task) => `${task.id}\n${task.verify}`).join("\n---\n"));
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    gitCommit,
    agents: agents.map((a) => a.name),
    results,
    keepRate: computeKeepRate(results),
    unpublished: opts.publishable === false,
    manifest: buildRunManifest({
      gitSha: gitCommit,
      promptHash,
      rulesHash,
      resolvedModel: opts.model,
      provider: opts.provider,
      publishable: opts.publishable !== false && opts.trials >= 3,
      maxTurns: Math.max(...tasks.map((task) => task.maxTurns ?? 40)),
      runTimeoutMs: Math.max(...tasks.map((task) => (task.timeoutSec ?? 300) * 1000)),
      sandboxMode: "danger-full-access",
      mcpProtocol: opts.provider === "mock" ? "none" : "2026-07-28",
    }),
  };
}

/** Run `fn` over items with at most `concurrency` in flight. Preserves result order. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.min(Math.max(1, concurrency), items.length);
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function runOne(
  agent: AgentAdapter,
  task: BenchTask,
  trial: number,
  opts: RunOptions,
): Promise<TaskResult> {
  const timeoutMs = (task.timeoutSec ?? 300) * 1000;
  const dir = await prepareWorkspace(task.id, task.fixtureDir);
  const start = Date.now();
  let keep = false;

  try {
    const runResult = await agent.run(task, dir, timeoutMs);
    const wallTimeMs = Date.now() - start;
    const diff = await diffStats(dir);

    let verifyOk = false;
    if (!runResult.timedOut && !runResult.agentError && !task.expectFailureKind) {
      const verify = await runShell(task.verify, dir, 120_000);
      verifyOk = verify.ok;
    } else if (task.expectFailureKind) {
      // Expected-failure tasks may still run verify as a soft check when the
      // agent unexpectedly completed; decideTaskVerdict owns the pass/fail.
      const verify = await runShell(task.verify, dir, 30_000);
      verifyOk = verify.ok;
    }

    const { passed, failureKind } = decideTaskVerdict({
      task,
      timedOut: runResult.timedOut,
      agentError: runResult.agentError,
      toolErrors: runResult.metrics.toolErrors,
      verifyOk,
    });

    keep = !passed && Boolean(opts.keepFailures);
    return {
      taskId: task.id,
      agentName: agent.name,
      trial,
      passed,
      failureKind,
      errorMessage: runResult.agentError,
      metrics: { wallTimeMs, ...diff, ...runResult.metrics },
      outputTail: runResult.outputTail + (keep ? `\n[workspace kept: ${dir}]` : ""),
    };
  } finally {
    if (!keep) await cleanupWorkspace(dir);
  }
}
