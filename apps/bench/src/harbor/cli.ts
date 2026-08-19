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
  pinnedTasksForProfile,
  type BenchmarkTruthConfig,
  type HarborProfileName,
} from "./config.js";
import {
  evaluateHarborTruthGates,
  harborTruthMarkdown,
  readHarborTruth,
} from "./truth.js";

const execFileAsync = promisify(execFile);

const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
type HarborReasoningEffort = (typeof REASONING_EFFORTS)[number];

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

function getFlag(args: string[], ...names: string[]): string | undefined {
  const index = args.findIndex((arg) => names.includes(arg));
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseNinjaBenchHarborArgs(args: string[]): {
  reasoningEffort?: HarborReasoningEffort;
  reuseBundle: boolean;
  harborArgs: string[];
} {
  const harborArgs: string[] = [];
  let reasoningEffort: HarborReasoningEffort | undefined;
  let reuseBundle = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--reasoning-effort") {
      const value = args[++i];
      if (!value || !REASONING_EFFORTS.includes(value as HarborReasoningEffort)) {
        throw new Error(`Invalid --reasoning-effort value: ${value ?? "<missing>"}`);
      }
      reasoningEffort = value as HarborReasoningEffort;
      continue;
    }
    if (arg === "--reuse-bundle") {
      reuseBundle = true;
      continue;
    }
    harborArgs.push(arg);
  }
  return { reasoningEffort, reuseBundle, harborArgs };
}

export function withReasoningEffort(
  config: BenchmarkTruthConfig,
  reasoningEffort: HarborReasoningEffort,
): BenchmarkTruthConfig {
  return { ...config, reasoningEffort };
}

export function uniqueSmokeJobName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `smoke-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function uniqueCanaryJobName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `canary-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function withJobName(args: string[], jobName: string): string[] {
  if (hasFlag(args, "--job-name")) return args;
  return ["--job-name", jobName, ...args];
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
  options: { reuseBundle?: boolean } = {},
): Promise<string> {
  const bundle = cliBundlePath();
  if (options.reuseBundle && existsSync(bundle)) {
    console.error("Reusing pinned NinjaCode CLI bundle…");
  } else {
    console.error("Building pinned NinjaCode CLI bundle…");
    const code = await spawnInherit("pnpm", ["--filter", "@ninjacode/cli", "bundle"], repoRoot());
    if (code !== 0) throw new Error(`CLI bundle failed (exit ${code})`);
  }
  if (!existsSync(bundle)) throw new Error(`CLI bundle missing after build: ${bundle}`);
  const manifest = await writeHarborBundleManifest(bundle, harborManifestPath(), {
    config,
    profile,
    model,
  });
  process.env.NINJACODE_BUNDLE = bundle;
  process.env.NINJACODE_BUNDLE_MANIFEST = harborManifestPath();
  console.error(
    `Harbor bundle: CLI ${manifest.cliVersion}, commit ${manifest.gitCommit.slice(0, 12)}` +
      `${manifest.gitTreeDirty ? "-dirty" : ""}, ` +
      `sha256 ${manifest.bundleSha256.slice(0, 12)}, profile ${profile}`,
  );
  if (manifest.gitTreeDirty) {
    console.error(
      "WARNING: the working tree is modified, so this bundle contains code that is not " +
        "in git history. The run will execute but its score is not publishable.",
    );
  }
  return bundle;
}

/**
 * Read back from the bundle the runner wrote, so an audit of a past run reflects
 * how that run was actually built rather than the tree as it stands now.
 */
async function bundleGitTreeDirty(): Promise<boolean | undefined> {
  try {
    const raw = await fs.readFile(harborManifestPath(), "utf8");
    const parsed = JSON.parse(raw) as { gitTreeDirty?: unknown };
    return typeof parsed.gitTreeDirty === "boolean" ? parsed.gitTreeDirty : undefined;
  } catch {
    return undefined;
  }
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
  await cmdProfile("smoke", withJobName(args, uniqueSmokeJobName()));
}

async function cmdCanary(args: string[]): Promise<void> {
  await cmdProfile("canary", withJobName(args, uniqueCanaryJobName()));
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

export function profileHarborArgs(
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
  for (const task of pinnedTasksForProfile(config, profile)) {
    args.push("--include-task-name", task.name);
  }
  return [...args, ...extraArgs, ...ninjacodeAgentArgs()];
}

async function cmdProfile(
  profile: HarborProfileName,
  args: string[],
): Promise<void> {
  const { reasoningEffort, reuseBundle, harborArgs } = parseNinjaBenchHarborArgs(args);
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
  const override = harborArgs.find((arg) => pinnedFlags.includes(arg));
  if (override) {
    throw new Error(`${override} is pinned by Harbor profile ${profile}`);
  }
  const config = await loadBenchmarkTruthConfig();
  const effective = reasoningEffort ? withReasoningEffort(config, reasoningEffort) : config;
  await requirePinnedHarborVersion(config.harborVersion);
  await ensureCliBundle(effective, profile, config.model, { reuseBundle });
  await runHarbor(profileHarborArgs(effective, profile, harborArgs));
  await auditProfileOutput(profile, harborArgs, config);
}

async function cmdPlan(args: string[]): Promise<void> {
  const profile = args[0] as HarborProfileName | undefined;
  if (!profile || !["smoke", "canary", "subset", "full", "publish"].includes(profile)) {
    throw new Error("Usage: ninjabench harbor plan smoke|canary|subset|full|publish");
  }
  const { reasoningEffort } = parseNinjaBenchHarborArgs(args.slice(1));
  const config = await loadBenchmarkTruthConfig();
  const effective = reasoningEffort ? withReasoningEffort(config, reasoningEffort) : config;
  console.log(
    JSON.stringify(
      {
        profile,
        harborVersion: effective.harborVersion,
        model: effective.model,
        reasoningEffort: effective.reasoningEffort,
        cliRunTimeoutMs: effective.timeouts.cliRunMs,
        command: ["harbor", ...profileHarborArgs(effective, profile, [])],
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
    minimumCorrectionPassRate: config.profiles[profile].minimumCorrectionPassRate,
    maximumAgentTimeoutRate: config.profiles[profile].maximumAgentTimeoutRate,
    baseline,
    bundleGitTreeDirty: await bundleGitTreeDirty(),
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

async function auditProfileOutput(
  profile: HarborProfileName,
  args: string[],
  config: BenchmarkTruthConfig,
): Promise<void> {
  const outputRoot = getFlag(args, "-o");
  const jobName = getFlag(args, "--job-name");
  if (!outputRoot || !jobName) return;
  const directory = path.resolve(outputRoot, jobName);
  try {
    await fs.access(directory);
  } catch {
    return;
  }
  const summary = await readHarborTruth(directory);
  const profileConfig = config.profiles[profile];
  const gate = evaluateHarborTruthGates(summary, {
    minimumTelemetryCoverage: config.gates.minimumTelemetryCoverage,
    maximumInfrastructureErrorRate: config.gates.maximumInfrastructureErrorRate,
    expectedTasks: profileConfig.expectedTasks,
    expectedAttempts: profileConfig.attempts,
    minimumCorrectionPassRate: profileConfig.minimumCorrectionPassRate,
    maximumAgentTimeoutRate: profileConfig.maximumAgentTimeoutRate,
    bundleGitTreeDirty: await bundleGitTreeDirty(),
  });
  const markdown = harborTruthMarkdown(summary, gate);
  console.log(markdown);
  if (!gate.passed) process.exitCode = 1;
}

function printHarborHelp(): void {
  console.log(
    [
      "Terminal-Bench 2.1 / Harbor — installed NinjaCode agent",
      "",
      "  ninjabench harbor oracle [harbor args]   Verify Harbor + Docker (1 oracle task)",
      "  ninjabench harbor plan PROFILE           Print a pinned command without running it",
      "  ninjabench harbor smoke [harbor args]    Pinned path-tracing canary (1×1, unique job name)",
      "  ninjabench harbor canary [harbor args]   Pinned write-compressor canary (1×3, unique job name)",
      "  ninjabench harbor canary --reasoning-effort xhigh --reuse-bundle",
      "      A/B the pinned effort against another on the same CLI bundle (rewrite manifest only)",
      "  ninjabench harbor subset [harbor args]   Stratified pinned subset (20×3)",
      "  ninjabench harbor full [harbor args]     Pinned full baseline (89×1)",
      "  ninjabench harbor publish [harbor args]  Pinned publication run (89×3)",
      "  ninjabench harbor audit DIR [options]    Taxonomy, telemetry and promotion gates",
      "  ninjabench harbor run [harbor args]      Legacy/custom Harbor passthrough",
      "",
      "Defaults:",
      `  -d ${DEFAULT_DATASET}`,
      "  oracle defaults to -l 1; smoke pins terminal-bench/path-tracing; canary pins write-compressor ×3",
      "",
      "Examples:",
      "  ninjabench harbor oracle",
      "  ninjabench harbor plan subset",
      "  ninjabench harbor plan canary --reasoning-effort high",
      "  ninjabench harbor smoke -n 1 -o runs/harbor",
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
    case "canary":
      await cmdCanary(rest);
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
