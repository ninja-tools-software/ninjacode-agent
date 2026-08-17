#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { isReasoningEffort, type ProviderKind, type ReasoningEffort } from "@ninjacode/providers";
import { loadTasks } from "./tasks.js";
import { runBench } from "./runner.js";
import { toMarkdown, summarize } from "./report.js";
import { cmdCompare } from "./compareCli.js";
import { createNinjaCodeAdapter } from "./adapters/ninjacode.js";
import { createCliAdapter, type CliAdapterConfig } from "./adapters/cli.js";
import type { AgentAdapter, RunReport } from "./types.js";
import {
  cmdSweBenchCompare,
  cmdSweBenchEval,
  cmdSweBenchPredict,
  printSweBenchHelp,
} from "./swebench/cli.js";
import { cmdHarbor } from "./harbor/cli.js";
import { ablationPlan, resolveAblationVariant } from "./ablations.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function reasoningEffort(args: string[]): ReasoningEffort | undefined {
  const value = getFlag(args, "reasoning-effort") ?? process.env.NINJABENCH_REASONING_EFFORT;
  if (value === undefined) return undefined;
  if (!isReasoningEffort(value)) {
    throw new Error(`Invalid --reasoning-effort value: ${value}`);
  }
  return value;
}

async function buildAgents(args: string[]): Promise<AgentAdapter[]> {
  const agents: AgentAdapter[] = [];
  const ablation = resolveAblationVariant(getFlag(args, "ablation"));

  // NinjaCode (in-process) unless --no-ninjacode
  if (!hasFlag(args, "no-ninjacode")) {
    const provider = (getFlag(args, "provider") ??
      process.env.NINJABENCH_PROVIDER ??
      (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock")) as ProviderKind | "mock";
    const apiKey =
      getFlag(args, "api-key") ??
      process.env.NINJABENCH_API_KEY ??
      process.env.DEEPSEEK_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENAI_API_KEY;
    const maxTurnsRaw = getFlag(args, "max-turns");
    const maxTurns = maxTurnsRaw ? Number.parseInt(maxTurnsRaw, 10) : undefined;
    agents.push(
      createNinjaCodeAdapter({
        provider,
        model: getFlag(args, "model") ?? process.env.NINJABENCH_MODEL,
        apiKey,
        baseUrl: getFlag(args, "base-url"),
        maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
        reasoningEffort: reasoningEffort(args),
        ablation,
      }),
    );
  }

  // Competitor CLIs from a JSON config (see agents.example.json)
  const agentsFile = getFlag(args, "agents");
  if (agentsFile) {
    const raw = await fs.readFile(agentsFile, "utf8");
    const configs = JSON.parse(raw) as CliAdapterConfig[];
    for (const config of configs) agents.push(createCliAdapter(config));
  }

  return agents;
}

async function cmdRun(args: string[]): Promise<void> {
  const filterIds = getFlag(args, "tasks")?.split(",");
  const suite = getFlag(args, "suite");
  const trials = Number.parseInt(getFlag(args, "trials") ?? "3", 10);
  const concurrency = Number.parseInt(getFlag(args, "concurrency") ?? "1", 10);
  const outDir = getFlag(args, "out") ?? path.join(process.cwd(), "runs");
  const tasksDir = getFlag(args, "tasks-dir") ?? process.env.NINJABENCH_HOLDOUT_DIR;
  if (hasFlag(args, "tasks-dir") && !tasksDir) {
    throw new Error("--tasks-dir requires a non-empty external corpus path");
  }

  const tasks = await loadTasks(tasksDir, { ids: filterIds, suite });
  if (tasks.length === 0) {
    console.error("No tasks found. Check apps/bench/tasks/ or your --tasks / --suite filter.");
    process.exitCode = 1;
    return;
  }
  if (tasksDir) {
    const minimum = Number.parseInt(process.env.NINJABENCH_HOLDOUT_MIN_TASKS ?? "10", 10);
    const maximum = Number.parseInt(process.env.NINJABENCH_HOLDOUT_MAX_TASKS ?? "15", 10);
    if (tasks.length < minimum || tasks.length > maximum) {
      throw new Error(
        `External holdout must contain ${minimum}-${maximum} tasks; found ${tasks.length}`,
      );
    }
  }
  const agents = await buildAgents(args);
  const ablation = resolveAblationVariant(getFlag(args, "ablation"));
  console.log(
    `NinjaBench: ${tasks.length} task(s) × ${agents.length} agent(s) × ${trials} trial(s)` +
      ` (concurrency ${concurrency})` +
      (suite ? ` [suite=${suite}]` : "") +
      `\nAgents: ${agents.map((a) => a.name).join(", ")}\n`,
  );

  const unpublished = hasFlag(args, "unpublished") || trials < 3;
  const report = await runBench(agents, tasks, {
    trials,
    concurrency,
    keepFailures: hasFlag(args, "keep-failures"),
    publishable: !unpublished,
    provider: getFlag(args, "provider"),
    model: getFlag(args, "model"),
    reasoningEffort: reasoningEffort(args),
    taskSource: tasksDir ? "external-holdout" : "repository",
    trajectoryDirectory: hasFlag(args, "no-trajectories")
      ? undefined
      : path.join(outDir, "trajectories"),
    ablation,
    onProgress: (line) => console.log(line),
  });

  await fs.mkdir(outDir, { recursive: true });
  const stamp = report.startedAt.replaceAll(":", "-").slice(0, 19);
  const jsonPath = path.join(outDir, `run-${stamp}.json`);
  const mdPath = path.join(outDir, `run-${stamp}.md`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, toMarkdown(report));

  console.log(`\n${renderSummaryTable(report)}`);
  console.log(`\nSaved: ${jsonPath}\n       ${mdPath}`);

  const anyFail = report.results.some((r) => !r.passed);
  if (anyFail && hasFlag(args, "strict")) process.exitCode = 1;
}

function cmdAblation(args: string[]): void {
  const [subcommand, scopeRaw] = args;
  const scope = scopeRaw as "quick" | "holdout" | "public-subset" | undefined;
  if (
    subcommand !== "plan" ||
    !scope ||
    !["quick", "holdout", "public-subset"].includes(scope)
  ) {
    throw new Error("Usage: ninjabench ablation plan quick|holdout|public-subset --variant NAME");
  }
  const variant = getFlag(args, "variant") ?? "no-parallel-reads";
  console.log(JSON.stringify(ablationPlan(scope, variant), null, 2));
}

function renderSummaryTable(report: RunReport): string {
  return summarize(report)
    .map(
      (s) =>
        `${s.agent.padEnd(40)} ${(s.passRate * 100).toFixed(1).padStart(5)}%  ` +
        `(${s.passed}/${s.total})  avg ${s.avgWallTimeSec.toFixed(1)}s` +
        (s.totalCostUsd !== undefined ? `  $${s.totalCostUsd.toFixed(4)}` : ""),
    )
    .join("\n");
}

async function cmdReport(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: ninjabench report <run.json>");
    process.exitCode = 1;
    return;
  }
  const report = JSON.parse(await fs.readFile(file, "utf8")) as RunReport;
  console.log(toMarkdown(report));
}

async function cmdList(args: string[]): Promise<void> {
  const suite = getFlag(args, "suite");
  const tasks = await loadTasks(undefined, suite ? { suite } : undefined);
  for (const t of tasks) {
    const suites = t.suites?.length ? ` suites=${t.suites.join(",")}` : "";
    console.log(
      `${t.id.padEnd(24)} [${t.category}/${t.difficulty}]${suites}  ${t.description}`,
    );
  }
}

async function cmdSweBench(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "predict":
      await cmdSweBenchPredict(rest);
      break;
    case "eval":
      await cmdSweBenchEval(rest);
      break;
    case "compare":
      await cmdSweBenchCompare(rest);
      break;
    default:
      printSweBenchHelp();
  }
}

function printMainHelp(): void {
  console.log(
    [
      "NinjaBench — benchmark harness for NinjaCode and competitor agents",
      "",
      "Usage:",
      "  ninjabench list [--suite NAME]          List available tasks",
      "  ninjabench run [options]                Run the benchmark",
      "  ninjabench report <run.json>            Re-render a saved run as markdown",
      "  ninjabench compare <base|dir> <current|dir>  Diff runs and apply CI gates",
      "  ninjabench swebench predict|eval|compare  SWE-bench Lite pipeline",
      "  ninjabench harbor plan|smoke|subset|full|publish|audit",
      "  ninjabench ablation plan quick|holdout|public-subset --variant NAME",
      "",
      "Run options:",
      "  --tasks a,b,c        Only run these task ids",
      "  --suite NAME         Only run tasks tagged with this suite (quick|harness)",
      "  --tasks-dir PATH     External task corpus (or NINJABENCH_HOLDOUT_DIR)",
      "  --trials N           Trials per (agent, task) pair (default 3)",
      "  --concurrency N      Parallel (agent, task, trial) runs (default 1)",
      "  --provider KIND      NinjaCode provider (anthropic|openai|deepseek|…|mock)",
      "  --model NAME         Model override",
      "  --reasoning-effort E Pin reasoning effort (low|medium|high|xhigh)",
      "  --ablation NAME      optimized|control|no-parallel-reads|no-async-persistence|no-provider-cache|no-context-deltas",
      "  --max-turns N        Cap agent turns (default 40; quick suite uses 20)",
      "  --api-key KEY        API key (defaults to env)",
      "  --agents FILE        JSON config of competitor CLIs (see agents.example.json)",
      "  --no-ninjacode       Skip the in-process NinjaCode agent",
      "  --keep-failures      Keep temp workspaces of failed runs for debugging",
      "  --no-trajectories    Disable redacted per-trial trajectory artifacts",
      "  --unpublished        Mark report non-publishable (also --trials < 3)",
      "  --out DIR            Output directory (default ./runs)",
      "  --strict             Exit non-zero if any task fails",
      "",
      "Compare gates (flags or BENCH_* environment variables):",
      "  --min-pass-rate 0..1",
      "  --max-pass-rate-drop 0..1",
      "  --max-cost-increase-pct N",
      "  --max-wall-time-increase-pct N",
      "  --max-p95-latency-increase-pct N",
      "  --max-tool-errors-increase N",
      "  --min-telemetry-coverage 0..1 (default 0.95)",
      "  --max-infra-error-rate 0..1 (default 0.05)",
      "  --min-pass-at-3 0..1",
      "  --min-pass-pow-3 0..1",
      "  --max-inter-trial-variance N",
      "  --min-confidence-lower-bound 0..1",
      "  --allow-incompatible  Permit different tasks/trial counts",
      "  --require-single-ablation  Require exactly one component difference",
      "",
      "Pyramid:",
      "  pnpm bench:harness   # deterministic mock scripts (CI gate)",
      "  pnpm bench:quick     # live DeepSeek flash iteration",
      "  ninjabench compare runs/quick/baseline.json runs/quick/run-….json",
      "",
      "SWE-bench: ninjabench swebench — run without args for subcommand help",
      "Harbor:    ninjabench harbor — Terminal-Bench 2.1 (oracle / smoke / canary / full run)",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "run":
      await cmdRun(args);
      break;
    case "report":
      await cmdReport(args);
      break;
    case "compare":
      await cmdCompare(args);
      break;
    case "list":
      await cmdList(args);
      break;
    case "swebench":
      await cmdSweBench(args);
      break;
    case "harbor":
      await cmdHarbor(args);
      break;
    case "ablation":
      cmdAblation(args);
      break;
    default:
      printMainHelp();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
