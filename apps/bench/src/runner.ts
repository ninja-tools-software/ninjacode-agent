import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { attachTrajectoryOutcome, persistTrajectory } from "@ninjacode/core";
import type { AgentAdapter, BenchTask, RunReport, TaskResult } from "./types.js";
import { computeKeepRate } from "./keepRate.js";
import { buildRunManifest, hashText } from "./manifest.js";
import { buildTrajectoryPairs } from "./report.js";
import { decideTaskVerdict } from "./verdict.js";
import { cleanupWorkspace, diffStats, prepareWorkspace, runShell } from "./workspace.js";
import type { AblationVariant } from "./ablations.js";

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
  reasoningEffort?: string;
  taskSource?: "repository" | "external-holdout";
  /** Explicit opt-in directory for one redacted trajectory artifact per trial. */
  trajectoryDirectory?: string;
  ablation?: AblationVariant;
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
  const taskSetHash = hashText(
    tasks.map((task) => `${task.id}\n${task.category}\n${task.difficulty}`).join("\n---\n"),
  );
  const report: RunReport = {
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
      reasoningEffort: opts.reasoningEffort,
      publishable: opts.publishable !== false && opts.trials >= 3,
      maxTurns: Math.max(...tasks.map((task) => task.maxTurns ?? 40)),
      runTimeoutMs: Math.max(...tasks.map((task) => (task.timeoutSec ?? 300) * 1000)),
      sandboxMode: "danger-full-access",
      mcpProtocol: opts.provider === "mock" ? "none" : "2026-07-28",
      taskSource: opts.taskSource,
      taskCount: tasks.length,
      trials: opts.trials,
      taskSetHash,
      ablation: opts.ablation,
    }),
  };
  report.trajectoryPairs = buildTrajectoryPairs(report);
  return report;
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
  const start = Date.now();
  let keep = false;
  let dir: string | undefined;

  try {
    try {
      dir = await prepareWorkspace(task.id, task.fixtureDir);
    } catch (error) {
      return infrastructureResult(agent.name, task.id, trial, start, error);
    }

    let runResult: Awaited<ReturnType<AgentAdapter["run"]>>;
    try {
      runResult = await agent.run(task, dir, timeoutMs);
    } catch (error) {
      return infrastructureResult(agent.name, task.id, trial, start, error);
    }
    const wallTimeMs = Date.now() - start;
    let diff: Awaited<ReturnType<typeof diffStats>>;
    try {
      diff = await diffStats(dir);
    } catch (error) {
      return infrastructureResult(agent.name, task.id, trial, start, error);
    }

    let verifyOk = false;
    let verifierTimedOut = false;
    let verifyOutput = "";
    if (!runResult.timedOut && !runResult.agentError && !task.expectFailureKind) {
      const verify = await runShell(task.verify, dir, 120_000);
      verifyOk = verify.ok;
      verifierTimedOut = verify.timedOut;
      verifyOutput = verify.output;
    } else if (task.expectFailureKind) {
      // Expected-failure tasks may still run verify as a soft check when the
      // agent unexpectedly completed; decideTaskVerdict owns the pass/fail.
      const verify = await runShell(task.verify, dir, 30_000);
      verifyOk = verify.ok;
      verifierTimedOut = verify.timedOut;
      verifyOutput = verify.output;
    }

    const { passed, failureKind } = decideTaskVerdict({
      task,
      timedOut: runResult.timedOut,
      verifierTimedOut,
      cancelled: runResult.cancelled,
      agentError: runResult.agentError,
      toolErrors: runResult.metrics.toolErrors,
      verifyOk,
    });

    const trajectoryPath = runResult.trajectory && opts.trajectoryDirectory
      ? path.join(
          opts.trajectoryDirectory,
          `${safeArtifactName(agent.name)}__${safeArtifactName(task.id)}__trial-${trial}.trajectory.json`,
        )
      : undefined;
    if (runResult.trajectory && trajectoryPath) {
      await persistTrajectory(
        trajectoryPath,
        attachTrajectoryOutcome(runResult.trajectory, {
          correctness: passed ? 1 : 0,
          completed: runResult.trajectory.outcome.completed,
        }),
      );
    }

    keep = !passed && Boolean(opts.keepFailures);
    return {
      taskId: task.id,
      agentName: agent.name,
      trial,
      passed,
      failureKind,
      errorMessage: runResult.agentError,
      metrics: { wallTimeMs, ...diff, ...runResult.metrics },
      trajectoryPath,
      outputTail:
        runResult.outputTail +
        (verifyOutput ? `\n[verifier]\n${verifyOutput}` : "") +
        (keep ? `\n[workspace kept: ${dir}]` : ""),
    };
  } finally {
    if (dir && !keep) await cleanupWorkspace(dir);
  }
}

function safeArtifactName(value: string): string {
  const safe = value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return safe.slice(0, 100) || "trial";
}

function infrastructureResult(
  agentName: string,
  taskId: string,
  trial: number,
  startedAt: number,
  error: unknown,
): TaskResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    taskId,
    agentName,
    trial,
    passed: false,
    failureKind: "infra_error",
    errorMessage: message,
    metrics: {
      wallTimeMs: Date.now() - startedAt,
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
      telemetryAvailable: false,
    },
    outputTail: message.slice(-8000),
  };
}
