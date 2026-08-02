import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface ChangedFileStat {
  path: string;
  additions: number;
  deletions: number;
}

export interface Checkpoint {
  id: string;
  label: string;
  createdAt: string;
  commitHash: string;
  /** Session that created this checkpoint (the index file is workspace-global). */
  sessionId?: string;
  /** Files touched since the previous checkpoint, with line-level +/- stats (best effort). */
  changedFiles?: ChangedFileStat[];
}

const DEFAULT_EXCLUDES = [
  "node_modules/",
  "dist/",
  ".git/",
  ".turbo/",
  "coverage/",
  ".pnpm-store/",
  "*.vsix",
  ".env",
  ".env.*",
  "*.log",
  ".ninjacode/",
];

/**
 * Shadow-git checkpoints for step-by-step rollback.
 * Separate git dir under .ninjacode/checkpoints.git; user repo untouched.
 * Uses GIT_INDEX_FILE + info/exclude so node_modules etc. are never staged.
 */
export class CheckpointManager {
  private readonly gitDir: string;
  private readonly workTree: string;
  private readonly agentDir: string;
  private readonly indexFile: string;
  private readonly redoStackPath: string;
  private ready = false;

  constructor(workspaceRoot: string, agentDir: string) {
    this.workTree = path.resolve(workspaceRoot);
    this.agentDir = agentDir;
    this.gitDir = path.join(agentDir, "checkpoints.git");
    this.indexFile = path.join(agentDir, "checkpoint-index");
    this.redoStackPath = path.join(agentDir, "checkpoint-redo.json");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.agentDir, { recursive: true });
    const exists = await fs
      .access(path.join(this.gitDir, "HEAD"))
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      await this.git(["init", "--bare", this.gitDir]);
    }

    await this.ensureExclude();
    // Baseline empty commit if no commits yet
    const head = await this.gitInWorktree(["rev-parse", "--verify", "HEAD"]).catch(() => "");
    if (!head.trim()) {
      await this.gitInWorktree(["add", "-A"]).catch(() => undefined);
      await this.gitInWorktree([
        "-c",
        "user.email=ninjacode@local",
        "-c",
        "user.name=NinjaCode",
        "commit",
        "--allow-empty",
        "-m",
        "baseline",
      ]).catch(() => undefined);
    }
    this.ready = true;
  }

  async create(label: string, meta?: { sessionId?: string }): Promise<Checkpoint> {
    if (!this.ready) await this.init();
    await this.ensureExclude();
    await this.gitInWorktree(["add", "-A"]);
    const msg = label.replace(/"/g, "'");
    const list = await this.list();
    const prevHash = list.at(-1)?.commitHash;
    try {
      await this.gitInWorktree([
        "-c",
        "user.email=ninjacode@local",
        "-c",
        "user.name=NinjaCode",
        "commit",
        "--allow-empty",
        "-m",
        msg,
      ]);
    } catch (e) {
      // If commit fails (nothing to commit without --allow-empty support), still record snapshot of HEAD
      void e;
      await this.gitInWorktree([
        "-c",
        "user.email=ninjacode@local",
        "-c",
        "user.name=NinjaCode",
        "commit",
        "--allow-empty",
        "-m",
        msg,
      ]).catch(() => undefined);
    }
    const hash = (await this.gitInWorktree(["rev-parse", "HEAD"])).trim();
    if (!hash) throw new Error("Failed to create checkpoint: empty HEAD");
    const changedFiles = await this.diffStat(prevHash, hash).catch(() => undefined);
    const cp: Checkpoint = {
      id: randomUUID(),
      label,
      createdAt: new Date().toISOString(),
      commitHash: hash,
      sessionId: meta?.sessionId,
      changedFiles,
    };
    await this.appendIndex(cp);
    return cp;
  }

  async restore(checkpointId: string): Promise<void> {
    if (!this.ready) await this.init();
    const list = await this.list();
    const cp = list.find((c) => c.id === checkpointId);
    if (!cp) throw new Error(`Checkpoint not found: ${checkpointId}`);
    // Remember where we were so `redo()` can bring back whatever this restore overwrites.
    const currentHead = (await this.gitInWorktree(["rev-parse", "HEAD"]).catch(() => "")).trim();
    if (currentHead && currentHead !== cp.commitHash) {
      const stack = await this.readRedoStack();
      stack.push(currentHead);
      await this.writeRedoStack(stack);
    }
    // Only reset tracked files — do not clean untracked (preserves .ninjacode metadata)
    await this.gitInWorktree(["reset", "--hard", cp.commitHash]);
  }

  /** Whether there's a pre-restore state available to jump forward to again. */
  async canRedo(): Promise<boolean> {
    return (await this.readRedoStack()).length > 0;
  }

  /** Undo the most recent `restore()` by jumping back to the state it overwrote. */
  async redo(): Promise<Checkpoint | null> {
    if (!this.ready) await this.init();
    const stack = await this.readRedoStack();
    const hash = stack.pop();
    if (!hash) return null;
    await this.writeRedoStack(stack);
    await this.gitInWorktree(["reset", "--hard", hash]);
    const list = await this.list();
    return (
      list.find((c) => c.commitHash === hash) ?? {
        id: "redo",
        label: "redo",
        createdAt: new Date().toISOString(),
        commitHash: hash,
      }
    );
  }

  async list(): Promise<Checkpoint[]> {
    const indexPath = path.join(this.agentDir, "checkpoints.json");
    try {
      return JSON.parse(await fs.readFile(indexPath, "utf8")) as Checkpoint[];
    } catch {
      return [];
    }
  }

  /** Line-level +/- stats for files touched between two commits (best effort; empty on error). */
  private async diffStat(fromHash: string | undefined, toHash: string): Promise<ChangedFileStat[]> {
    if (!fromHash || fromHash === toHash) return [];
    const out = await this.gitInWorktree(["diff", "--numstat", fromHash, toHash]).catch(() => "");
    const stats: ChangedFileStat[] = [];
    for (const line of out.split("\n")) {
      const m = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line.trim());
      if (!m) continue;
      stats.push({
        path: m[3]!,
        additions: m[1] === "-" ? 0 : Number(m[1]),
        deletions: m[2] === "-" ? 0 : Number(m[2]),
      });
    }
    return stats;
  }

  private async readRedoStack(): Promise<string[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.redoStackPath, "utf8"));
      return Array.isArray(raw) ? (raw as string[]) : [];
    } catch {
      return [];
    }
  }

  private async writeRedoStack(stack: string[]): Promise<void> {
    await fs.writeFile(this.redoStackPath, JSON.stringify(stack), "utf8");
  }

  private async ensureExclude(): Promise<void> {
    const infoDir = path.join(this.gitDir, "info");
    await fs.mkdir(infoDir, { recursive: true });
    const excludePath = path.join(infoDir, "exclude");
    await fs.writeFile(excludePath, DEFAULT_EXCLUDES.join("\n") + "\n", "utf8");
  }

  private async appendIndex(cp: Checkpoint): Promise<void> {
    const indexPath = path.join(this.agentDir, "checkpoints.json");
    const list = await this.list();
    list.push(cp);
    await fs.writeFile(indexPath, JSON.stringify(list, null, 2), "utf8");
  }

  private git(args: string[]): Promise<string> {
    return runGit(args, this.workTree, {});
  }

  private gitInWorktree(args: string[]): Promise<string> {
    return runGit(["--git-dir", this.gitDir, "--work-tree", this.workTree, ...args], this.workTree, {
      GIT_INDEX_FILE: this.indexFile,
    });
  }
}

function runGit(
  args: string[],
  cwd: string,
  extraEnv: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        ...extraEnv,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}
