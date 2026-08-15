import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  agentImportPath,
  cliBundlePath,
  DEFAULT_DATASET,
  repoRoot,
} from "./paths.js";

function hasFlag(args: string[], ...names: string[]): boolean {
  return names.some((name) => args.includes(name));
}

function spawnInherit(command: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
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

async function ensureCliBundle(): Promise<string> {
  const bundle = cliBundlePath();
  if (existsSync(bundle)) return bundle;
  console.error("Building NinjaCode CLI bundle…");
  const code = await spawnInherit("pnpm", ["--filter", "@ninjacode/cli", "bundle"], repoRoot());
  if (code !== 0) throw new Error(`CLI bundle failed (exit ${code})`);
  if (!existsSync(bundle)) throw new Error(`CLI bundle missing after build: ${bundle}`);
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
  return [
    "--agent",
    "ninjacode_agent:NinjaCodeAgent",
    "--agent-import-path",
    agentImportPath(),
  ];
}

async function runHarbor(args: string[]): Promise<void> {
  const code = await spawnInherit("harbor", args);
  if (code !== 0) process.exitCode = code;
}

async function cmdOracle(args: string[]): Promise<void> {
  await runHarbor(["run", ...withDefaultLimit(withDefaultDataset(args), "1"), "-a", "oracle"]);
}

async function cmdSmoke(args: string[]): Promise<void> {
  await ensureCliBundle();
  const harborArgs = withDefaultModel(withDefaultLimit(withDefaultDataset(args), "1"));
  if (!hasFlag(harborArgs, "-m", "--model")) {
    throw new Error(
      "Pass -m provider/model (e.g. deepseek/deepseek-chat) or set NINJABENCH_MODEL.",
    );
  }
  await runHarbor(["run", ...harborArgs, ...ninjacodeAgentArgs()]);
}

async function cmdRun(args: string[]): Promise<void> {
  await ensureCliBundle();
  const harborArgs = withDefaultModel(withDefaultDataset(args));
  if (!hasFlag(harborArgs, "-m", "--model")) {
    throw new Error(
      "Pass -m provider/model (e.g. deepseek/deepseek-chat) or set NINJABENCH_MODEL.",
    );
  }
  await runHarbor(["run", ...harborArgs, ...ninjacodeAgentArgs()]);
}

export function printHarborHelp(): void {
  console.log(
    [
      "Terminal-Bench 2.1 / Harbor — installed NinjaCode agent",
      "",
      "  ninjabench harbor oracle [harbor args]   Verify Harbor + Docker (1 oracle task)",
      "  ninjabench harbor smoke [harbor args]    1 TB 2.1 task with NinjaCode (not comparable)",
      "  ninjabench harbor run [harbor args]      Full TB 2.1 (89 tasks, leaderboard-comparable)",
      "",
      "Defaults:",
      `  -d ${DEFAULT_DATASET}`,
      "  oracle/smoke add -l 1 unless you pass -l / --limit",
      "",
      "Examples:",
      "  ninjabench harbor oracle",
      "  ninjabench harbor smoke -m deepseek/deepseek-chat",
      "  ninjabench harbor run -m deepseek/deepseek-chat -n 4",
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
    case "run":
      await cmdRun(rest);
      break;
    default:
      printHarborHelp();
  }
}
