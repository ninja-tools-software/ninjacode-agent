#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderKind } from "@ninjacode/providers";
import { loadTasks } from "./tasks.js";
import { runBench } from "./runner.js";
import { toMarkdown, summarize } from "./report.js";
import { compareToMarkdown } from "./compare.js";
import { createNinjaCodeAdapter } from "./adapters/ninjacode.js";
import { createCliAdapter, type CliAdapterConfig } from "./adapters/cli.js";
import type { AgentAdapter, RunReport } from "./types.js";
import {
  cmdSweBenchCompare,
  cmdSweBenchEval,
  cmdSweBenchPredict,
  printSweBenchHelp,
} from "./swebench/cli.js";

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

async function buildAgents(args: string[]): Promise<AgentAdapter[]> {
  const agents: AgentAdapter[] = [];

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

  const tasks = await loadTasks(undefined, { ids: filterIds, suite });
  if (tasks.length === 0) {
    console.error("No tasks found. Check apps/bench/tasks/ or your --tasks / --suite filter.");
    process.exitCode = 1;
    return;
  }
  const agents = await buildAgents(args);
  console.log(
    `NinjaBench: ${tasks.length} task(s) × ${agents.length} agent(s) × ${trials} trial(s)` +
      ` (concurrency ${concurrency})` +
      (suite ? ` [suite=${suite}]` : "") +
      `\nAgents: ${agents.map((a) => a.name).join(", ")}\n`,
  );

  const report = await runBench(agents, tasks, {
    trials,
    concurrency,
    keepFailures: hasFlag(args, "keep-failures"),
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

async function cmdCompare(args: string[]): Promise<void> {
  const files = args.filter((a) => !a.startsWith("--"));
  if (files.length < 2) {
    console.error("Usage: ninjabench compare <baseline.json> <after.json>");
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(await fs.readFile(files[0], "utf8")) as RunReport;
  const after = JSON.parse(await fs.readFile(files[1], "utf8")) as RunReport;
  console.log(compareToMarkdown(baseline, after));
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
    default:
      console.log(
        [
          "NinjaBench — benchmark harness for NinjaCode and competitor agents",
          "",
          "Usage:",
          "  ninjabench list [--suite NAME]          List available tasks",
          "  ninjabench run [options]                Run the benchmark",
          "  ninjabench report <run.json>            Re-render a saved run as markdown",
          "  ninjabench compare <base.json> <after.json>  Diff two NinjaBench runs",
          "  ninjabench swebench predict|eval|compare  SWE-bench Lite pipeline",
          "",
          "Run options:",
          "  --tasks a,b,c        Only run these task ids",
          "  --suite NAME         Only run tasks tagged with this suite (quick|harness)",
          "  --trials N           Trials per (agent, task) pair (default 3)",
          "  --concurrency N      Parallel (agent, task, trial) runs (default 1)",
          "  --provider KIND      NinjaCode provider (anthropic|openai|deepseek|…|mock)",
          "  --model NAME         Model override",
          "  --max-turns N        Cap agent turns (default 40; quick suite uses 20)",
          "  --api-key KEY        API key (defaults to env)",
          "  --agents FILE        JSON config of competitor CLIs (see agents.example.json)",
          "  --no-ninjacode       Skip the in-process NinjaCode agent",
          "  --keep-failures      Keep temp workspaces of failed runs for debugging",
          "  --out DIR            Output directory (default ./runs)",
          "  --strict             Exit non-zero if any task fails",
          "",
          "Pyramid:",
          "  pnpm bench:harness   # deterministic mock scripts (CI gate)",
          "  pnpm bench:quick     # live DeepSeek flash iteration",
          "  ninjabench compare runs/quick/baseline.json runs/quick/run-….json",
          "",
          "SWE-bench: ninjabench swebench — run without args for subcommand help",
        ].join("\n"),
      );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
