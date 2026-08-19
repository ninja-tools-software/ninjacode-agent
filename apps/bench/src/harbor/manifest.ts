import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { benchRoot, cliBundlePath, repoRoot } from "./paths.js";
import {
  loadBenchmarkTruthConfig,
  type BenchmarkTruthConfig,
  type HarborProfileName,
} from "./config.js";
import { ablationComponents, resolveAblationVariant } from "../ablations.js";

const execFileAsync = promisify(execFile);

export const HARBOR_ADAPTER_VERSION = "1.2.0";
export const HARBOR_MANIFEST_SCHEMA_VERSION = 3;

interface HarborBundleManifest {
  schemaVersion: number;
  adapterVersion: string;
  cliVersion: string;
  gitCommit: string;
  /**
   * A commit alone does not identify the bundle: one built from a modified tree
   * carries code that exists nowhere in history, so its score cannot be
   * reproduced or attributed. Recording this is what makes `publishable` honest.
   */
  gitTreeDirty: boolean;
  bundleSha256: string;
  bundleBytes: number;
  minimumNodeMajor: number;
  preferredNodeVersion: string;
  harborVersion: string;
  dataset: string;
  model: string;
  reasoningEffort: string;
  cliRunTimeoutMs: number;
  agentTimeoutMultiplier: number;
  verifierTimeoutMultiplier: number;
  profile: HarborProfileName;
  expectedTasks: number;
  attempts: number;
  publishable: boolean;
  ablation: {
    name: string;
    disabled: string[];
    components: Record<string, boolean>;
  };
}

export function harborManifestPath(): string {
  return path.join(path.dirname(cliBundlePath()), "ninjacode.harbor-manifest.json");
}

async function resolveGitCommit(): Promise<string> {
  const fromEnv = process.env.NINJACODE_GIT_COMMIT ?? process.env.GITHUB_SHA;
  if (fromEnv?.trim()) return fromEnv.trim();
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot() });
    return stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Reported as dirty when the answer is unknown: an unverifiable tree is exactly
 * as unpublishable as one we know was modified.
 */
async function resolveGitTreeDirty(): Promise<boolean> {
  if ((process.env.NINJACODE_GIT_COMMIT ?? process.env.GITHUB_SHA)?.trim()) return false;
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot() });
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function cliVersion(): Promise<string> {
  const packagePath = path.join(benchRoot(), "..", "cli", "package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error(`CLI package has no valid version: ${packagePath}`);
  }
  return parsed.version;
}

export async function buildHarborBundleManifest(
  bundlePath = cliBundlePath(),
  options: {
    config?: BenchmarkTruthConfig;
    profile?: HarborProfileName;
    model?: string;
  } = {},
): Promise<HarborBundleManifest> {
  const config = options.config ?? (await loadBenchmarkTruthConfig());
  const profile = options.profile ?? "smoke";
  const profileConfig = config.profiles[profile];
  const ablation = resolveAblationVariant(
    process.env.NINJACODE_PERF_ABLATION ?? "optimized",
  );
  const bundle = await readFile(bundlePath);
  const gitTreeDirty = await resolveGitTreeDirty();
  return {
    schemaVersion: HARBOR_MANIFEST_SCHEMA_VERSION,
    adapterVersion: HARBOR_ADAPTER_VERSION,
    cliVersion: await cliVersion(),
    gitCommit: await resolveGitCommit(),
    gitTreeDirty,
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    bundleBytes: bundle.byteLength,
    minimumNodeMajor: config.node.minimumMajor,
    preferredNodeVersion: config.node.preferredVersion,
    harborVersion: config.harborVersion,
    dataset: config.dataset,
    model: options.model ?? config.model,
    reasoningEffort: config.reasoningEffort,
    cliRunTimeoutMs: config.timeouts.cliRunMs,
    agentTimeoutMultiplier: config.timeouts.agentMultiplier,
    verifierTimeoutMultiplier: config.timeouts.verifierMultiplier,
    profile,
    expectedTasks: profileConfig.expectedTasks,
    attempts: profileConfig.attempts,
    publishable: profileConfig.publishable && !gitTreeDirty,
    ablation: {
      name: ablation.name,
      disabled: ablation.disabled,
      components: ablationComponents(ablation),
    },
  };
}

export async function writeHarborBundleManifest(
  bundlePath = cliBundlePath(),
  outputPath = harborManifestPath(),
  options: {
    config?: BenchmarkTruthConfig;
    profile?: HarborProfileName;
    model?: string;
  } = {},
): Promise<HarborBundleManifest> {
  const manifest = await buildHarborBundleManifest(bundlePath, options);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
