import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { benchRoot, cliBundlePath, repoRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export const HARBOR_ADAPTER_VERSION = "1.0.0";
export const HARBOR_MANIFEST_SCHEMA_VERSION = 1;
const MINIMUM_NODE_MAJOR = 20;
const PREFERRED_NODE_VERSION = "22.17.1";

interface HarborBundleManifest {
  schemaVersion: number;
  adapterVersion: string;
  cliVersion: string;
  gitCommit: string;
  bundleSha256: string;
  bundleBytes: number;
  minimumNodeMajor: number;
  preferredNodeVersion: string;
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
): Promise<HarborBundleManifest> {
  const bundle = await readFile(bundlePath);
  return {
    schemaVersion: HARBOR_MANIFEST_SCHEMA_VERSION,
    adapterVersion: HARBOR_ADAPTER_VERSION,
    cliVersion: await cliVersion(),
    gitCommit: await resolveGitCommit(),
    bundleSha256: createHash("sha256").update(bundle).digest("hex"),
    bundleBytes: bundle.byteLength,
    minimumNodeMajor: MINIMUM_NODE_MAJOR,
    preferredNodeVersion: PREFERRED_NODE_VERSION,
  };
}

export async function writeHarborBundleManifest(
  bundlePath = cliBundlePath(),
  outputPath = harborManifestPath(),
): Promise<HarborBundleManifest> {
  const manifest = await buildHarborBundleManifest(bundlePath);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
