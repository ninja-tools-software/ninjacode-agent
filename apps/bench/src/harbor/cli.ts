import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  agentImportPath,
  cliBundlePath,
  DEFAULT_DATASET,
  repoRoot,
} from "./paths.js";
import { harborManifestPath, writeHarborBundleManifest } from "./manifest.js";
import {
  loadBenchmarkTruthConfig,
  type BenchmarkTruthConfig,
  type HarborProfileName,
} from "./config.js";
import {
  evaluateHarborTruthGates,
  harborTruthMarkdown,
  readHarborTruth,
} from "./truth.js";

const execFileAsync = promisify(execFile);

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

function getFlag(args: string[], ...names: string[]): string | undefined {
  const index = args.findIndex((arg) => names.includes(arg));
  return index >= 0 ? args[index + 1] : undefined;
}

function harborPythonPath(): string {
  const harborDir = path.dirname(agentImportPath());
  const existing = process.env.PYTHONPATH;
  return existing ? `${harborDir}${path.delimiter}${existing}` : harborDir;
}

function spawnInherit(command: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(command === "harbor" ? { PYTHONPATH: harborPythonPath() } : {}),
      },
    });
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            command === "harbor"
              ? "harbor is not on PATH. Install it with: uv tool install harbor"
              : `Failed to spawn ${command}`,
          ),
        );
        return;
      }
      reject(err);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function ensureCliBundle(
  config: BenchmarkTruthConfig,
  profile: HarborProfileName,
  model: string,
): Promise<string> {
  const bundle = cliBundlePath();
  console.error("Building pinned NinjaCode CLI bundle…");
  const code = await spawnInherit("pnpm", ["--filter", "@ninjacode/cli", "bundle"], repoRoot());
  if (code !== 0) throw new Error(`CLI bundle failed (exit ${code})`);
  if (!existsSync(bundle)) throw new Error(`CLI bundle missing after build: ${bundle}`);
  const manifest = await writeHarborBundleManifest(bundle, harborManifestPath(), {
    config,
    profile,
    model,
  });
  process.env.NINJACODE_BUNDLE = bundle;
  process.env.NINJACODE_BUNDLE_MANIFEST = harborManifestPath();
  console.error(
    `Harbor bundle: CLI ${manifest.cliVersion}, commit ${manifest.gitCommit.slice(0, 12)}, ` +
      `sha256 ${manifest.bundleSha256.slice(0, 12)}, profile ${profile}`,
  );
  return bundle;
}

function withDefaultDataset(args: string[]): string[] {
  if (hasFlag(args, "-d", "--dataset")) return args;
  return ["-d", DEFAULT_DATASET, ...args];
}

function withDefaultLimit(args: string[], limit: string): string[] {
  if (hasFlag(args, "-l", "--limit")) return args;
  return ["-l", limit, ...args];
}

function withDefaultModel(args: string[]): string[] {
  if (hasFlag(args, "-m", "--model")) return args;
  const fromEnv = process.env.NINJABENCH_MODEL;
  if (fromEnv) return ["-m", fromEnv, ...args];
  return args;
}

function ninjacodeAgentArgs(): string[] {
  return ["--agent", "ninjacode_agent:NinjaCodeAgent"];
}

async function runHarbor(args: string[]): Promise<void> {
  const code = await spawnInherit("harbor", args);
  if (code !== 0) process.exitCode = code;
}

async function requirePinnedHarborVersion(expected: string): Promise<void> {
  let actual: string;
  try {
    const result = await execFileAsync("harbor", ["--version"]);
    actual = result.stdout.trim();
  } catch {
    throw new Error(`harbor ${expected} is required. Install it with: uv tool install harbor==${expected}`);
  }
  if (actual !== expected) {
    throw new Error(`Harbor ${actual} does not match pinned version ${expected}`);
  }
}

async function cmdOracle(args: string[]): Promise<void> {
  await runHarbor(["run", ...withDefaultLimit(withDefaultDataset(args), "1"), "-a", "oracle"]);
}

async function cmdSmoke(args: string[]): Promise<void> {
  await cmdProfile("smoke", args);
}

async function cmdRun(args: string[]): Promise<void> {
  const config = await loadBenchmarkTruthConfig();
  const harborArgs = withDefaultModel(withDefaultDataset(args));
  if (!hasFlag(harborArgs, "-m", "--model")) {
    throw new Error(
      "Pass -m provider/model (e.g. deepseek/deepseek-chat) or set NINJABENCH_MODEL.",
    );
  }
  const model = getFlag(harborArgs, "-m", "--model")!;
  await requirePinnedHarborVersion(config.harborVersion);
  await ensureCliBundle(config, "full", model);
  await runHarbor(["run", ...harborArgs, ...ninjacodeAgentArgs()]);
}

function profileHarborArgs(
  config: BenchmarkTruthConfig,
  profile: HarborProfileName,
  extraArgs: string[],
): string[] {
  const profileConfig = config.profiles[profile];
  const args = [
    "run",
    "-d",
    config.dataset,
    "-m",
    config.model,
    "-k",
    String(profileConfig.attempts),
    "-l",
    String(profileConfig.expectedTasks),
    "--agent-timeout-multiplier",
    String(config.timeouts.agentMultiplier),
    "--verifier-timeout-multiplier",
    String(config.timeouts.verifierMultiplier),
  ];
  if (profile === "subset") {
    for (const task of config.subset) {
      args.push("--include-task-name", task.name);
    }
  }
  return [...args, ...extraArgs, ...ninjacodeAgentArgs()];
}

async function cmdProfile(
  profile: HarborProfileName,
  args: string[],
): Promise<void> {
  const pinnedFlags = [
    "-d",
    "--dataset",
    "-m",
    "--model",
    "-k",
    "--n-attempts",
    "-l",
    "--n-tasks",
    "--agent-timeout-multiplier",
    "--verifier-timeout-multiplier",
  ];
  const override = args.find((arg) => pinnedFlags.includes(arg));
  if (override) {
    throw new Error(`${override} is pinned by Harbor profile ${profile}`);
  }
  const config = await loadBenchmarkTruthConfig();
  await requirePinnedHarborVersion(config.harborVersion);
  await ensureCliBundle(config, profile, config.model);
  await runHarbor(profileHarborArgs(config, profile, args));
}

async function cmdPlan(args: string[]): Promise<void> {
  const profile = args[0] as HarborProfileName | undefined;
  if (!profile || !["smoke", "subset", "full", "publish"].includes(profile)) {
    throw new Error("Usage: ninjabench harbor plan smoke|subset|full|publish");
  }
  const config = await loadBenchmarkTruthConfig();
  console.log(
    JSON.stringify(
      {
        profile,
        harborVersion: config.harborVersion,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        cliRunTimeoutMs: config.timeouts.cliRunMs,
        command: ["harbor", ...profileHarborArgs(config, profile, [])],
      },
      null,
      2,
    ),
  );
}

async function cmdAudit(args: string[]): Promise<void> {
  const directory = args.find((arg) => !arg.startsWith("-"));
  if (!directory) {
    throw new Error("Usage: ninjabench harbor audit <run-dir> [--profile NAME] [--baseline DIR]");
  }
  const config = await loadBenchmarkTruthConfig();
  const profile = (getFlag(args, "--profile") ?? "full") as HarborProfileName;
  if (!config.profiles[profile]) throw new Error(`Unknown Harbor profile: ${profile}`);
  const summary = await readHarborTruth(directory);
  const baselinePath = getFlag(args, "--baseline");
  const baseline = baselinePath ? await readHarborTruth(baselinePath) : undefined;
  const gate = evaluateHarborTruthGates(summary, {
    minimumTelemetryCoverage: config.gates.minimumTelemetryCoverage,
    maximumInfrastructureErrorRate: config.gates.maximumInfrastructureErrorRate,
    expectedTasks: config.profiles[profile].expectedTasks,
    expectedAttempts: config.profiles[profile].attempts,
    baseline,
  });
  const markdown = harborTruthMarkdown(summary, gate);
  console.log(markdown);
  const output = getFlag(args, "--output");
  if (output) {
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(output, markdown);
  }
  if (!gate.passed) process.exitCode = 1;
}

function printHarborHelp(): void {
  console.log(
    [
      "Terminal-Bench 2.1 / Harbor — installed NinjaCode agent",
      "",
      "  ninjabench harbor oracle [harbor args]   Verify Harbor + Docker (1 oracle task)",
      "  ninjabench harbor plan PROFILE           Print a pinned command without running it",
      "  ninjabench harbor smoke [harbor args]    Instrumented pinned smoke (1×1)",
      "  ninjabench harbor subset [harbor args]   Stratified pinned subset (20×3)",
      "  ninjabench harbor full [harbor args]     Pinned full baseline (89×1)",
      "  ninjabench harbor publish [harbor args]  Pinned publication run (89×3)",
      "  ninjabench harbor audit DIR [options]    Taxonomy, telemetry and promotion gates",
      "  ninjabench harbor run [harbor args]      Legacy/custom Harbor passthrough",
      "",
      "Defaults:",
      `  -d ${DEFAULT_DATASET}`,
      "  oracle/smoke add -l 1 unless you pass -l / --limit",
      "",
      "Examples:",
      "  ninjabench harbor oracle",
      "  ninjabench harbor plan subset",
      "  ninjabench harbor smoke -n 1 -o runs/harbor/smoke",
      "  ninjabench harbor audit runs/harbor/full --profile full",
      "",
      "OpenThoughts-TBLite is faster but not comparable to the TB 2.1 leaderboard:",
      "  ninjabench harbor run -d openthoughts-tblite -m deepseek/deepseek-chat -n 4",
    ].join("\n"),
  );
}

export async function cmdHarbor(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "oracle":
      await cmdOracle(rest);
      break;
    case "smoke":
      await cmdSmoke(rest);
      break;
    case "subset":
      await cmdProfile("subset", rest);
      break;
    case "full":
      await cmdProfile("full", rest);
      break;
    case "publish":
      await cmdProfile("publish", rest);
      break;
    case "plan":
      await cmdPlan(rest);
      break;
    case "audit":
      await cmdAudit(rest);
      break;
    case "run":
      await cmdRun(rest);
      break;
    default:
      printHarborHelp();
  }
}
