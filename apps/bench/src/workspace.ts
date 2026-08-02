import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Creates a temp workspace, copies the fixture in, and inits git for diff stats. */
export async function prepareWorkspace(taskId: string, fixtureDir?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `ninjabench-${taskId}-`));
  if (fixtureDir) {
    await fs.cp(fixtureDir, dir, { recursive: true });
  }
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.email=bench@ninjacode.dev",
      "-c",
      "user.name=NinjaBench",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "fixture",
    ],
    { cwd: dir },
  );
  return dir;
}

export async function diffStats(dir: string): Promise<{ filesChanged: number; linesAdded: number; linesRemoved: number }> {
  await execFileAsync("git", ["add", "-A"], { cwd: dir });
  const { stdout } = await execFileAsync("git", ["diff", "--cached", "--numstat", "HEAD"], { cwd: dir });
  // Unstage so verify commands like `git diff --quiet HEAD -- file` keep their
  // intended semantics (new agent files stay untracked, not staged-vs-HEAD).
  await execFileAsync("git", ["reset", "-q"], { cwd: dir });
  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of stdout.split("\n")) {
    const [added, removed] = line.split("\t");
    if (added === undefined || removed === undefined) continue;
    filesChanged += 1;
    linesAdded += Number.parseInt(added, 10) || 0;
    linesRemoved += Number.parseInt(removed, 10) || 0;
  }
  return { filesChanged, linesAdded, linesRemoved };
}

export async function cleanupWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Runs a shell command in the workspace; resolves with pass/fail + output tail. */
export function runShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; timedOut: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, timedOut, output });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, timedOut, output: output + String(err) });
    });
  });
}
