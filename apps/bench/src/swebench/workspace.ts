import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SweBenchInstance } from "./types.js";

const execFileAsync = promisify(execFile);

/** Shallow clone at base_commit for one SWE-bench instance. */
export async function prepareSweBenchWorkspace(instance: SweBenchInstance): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `swebench-${instance.instance_id}-`));
  const repoUrl = `https://github.com/${instance.repo}.git`;
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["remote", "add", "origin", repoUrl], { cwd: dir });
  await execFileAsync("git", ["fetch", "--depth", "1", "origin", instance.base_commit], { cwd: dir });
  await execFileAsync("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: dir });
  return dir;
}

/** Captures agent edits as a unified diff against HEAD (base commit). */
export async function extractModelPatch(workspaceDir: string): Promise<string> {
  await execFileAsync("git", ["add", "-A"], { cwd: workspaceDir });
  const { stdout } = await execFileAsync("git", ["diff", "--cached", "HEAD"], { cwd: workspaceDir });
  return stdout;
}

export async function cleanupSweBenchWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
