import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { joinWorkspace, toWorkspaceRelative } from "@ninjacode/tools";
import { computeHunks } from "./proposedEditsHunks.js";
import type { Hunk } from "./proposedEditsTypes.js";

export interface ProposedEdit {
  path: string;
  before: string;
  after: string;
  /** Working baseline hunk accept/reject operate against. Starts equal to `before`. */
  current: string;
  diff?: string;
  /** Session this edit was proposed under, when known. */
  sessionId?: string;
  /** Always requires explicit review — `.env*`, `.vscode/**`, credential-looking files. */
  sensitive: boolean;
  /** True when the edit is already written to disk (apply-first flow). */
  applied?: boolean;
  createdAt: string;
}

interface EditStats {
  additions: number;
  deletions: number;
}

const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.[^/]*)?$/i,
  /^\.vscode\//i,
  /credentials?/i,
  /(^|\/)id_rsa(\.[^/]+)?$/i,
  /\.(pem|pfx|p12|key)$/i,
  /(^|\/)secrets?\.(json|ya?ml|env)$/i,
];

/** Files that should always require explicit review, regardless of the `reviewEdits` setting. */
function isSensitivePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return SENSITIVE_PATTERNS.some((re) => re.test(p));
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Holds agent edits in memory until the user accepts/rejects them (in full, or hunk by
 * hunk). Diffs are shown via a virtual document scheme `ninjacode-proposed:`. Optionally
 * persisted to `.ninjacode/proposed-edits.json` so pending edits survive a reload.
 */
export class ProposedEditsStore {
  private edits = new Map<string, ProposedEdit>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private agentDir?: string;
  private workspaceRoot?: string;
  private persistTimer?: ReturnType<typeof setTimeout>;

  /** Point persistence at a workspace's `.ninjacode` dir. Safe to call again on workspace change. */
  configure(agentDir: string, workspaceRoot?: string): void {
    this.agentDir = agentDir;
    if (workspaceRoot) this.workspaceRoot = workspaceRoot;
  }

  dispose(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }

  /** Load previously-pending edits from disk (call once after `configure`, e.g. on activate). */
  async restore(): Promise<void> {
    if (!this.agentDir) return;
    try {
      const raw = await fs.readFile(path.join(this.agentDir, "proposed-edits.json"), "utf8");
      const saved = JSON.parse(raw) as ProposedEdit[];
      this.edits.clear();
      for (const e of saved) {
        if (!e?.path) continue;
        this.edits.set(normalize(e.path), {
          path: e.path,
          before: e.before ?? "",
          after: e.after ?? "",
          current: e.current ?? e.before ?? "",
          diff: e.diff,
          sessionId: e.sessionId,
          sensitive: e.sensitive ?? isSensitivePath(e.path),
          applied: e.applied ?? false,
          createdAt: e.createdAt ?? new Date().toISOString(),
        });
      }
      this._onDidChange.fire();
    } catch {
      // nothing persisted yet
    }
  }

  private schedulePersist(): void {
    if (!this.agentDir) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persistNow(), 250);
  }

  private async persistNow(): Promise<void> {
    if (!this.agentDir) return;
    try {
      await fs.mkdir(this.agentDir, { recursive: true });
      await fs.writeFile(
        path.join(this.agentDir, "proposed-edits.json"),
        JSON.stringify(this.list(), null, 2),
        "utf8",
      );
    } catch {
      // best effort — pending edits are still available in memory this session
    }
  }

  set(edit: {
    path: string;
    before: string;
    after: string;
    diff?: string;
    sessionId?: string;
    applied?: boolean;
  }): void {
    const rel = this.workspaceRoot
      ? toWorkspaceRelative(this.workspaceRoot, edit.path)
      : normalize(edit.path).replace(/^\/+/, "");
    const key = normalize(rel);
    this.edits.set(key, {
      path: key,
      before: edit.before,
      after: edit.after,
      current: edit.before,
      diff: edit.diff,
      sessionId: edit.sessionId,
      sensitive: isSensitivePath(key),
      applied: edit.applied ?? false,
      createdAt: new Date().toISOString(),
    });
    this._onDidChange.fire();
    this.schedulePersist();
  }

  get(relPath: string): ProposedEdit | undefined {
    return this.edits.get(normalize(relPath));
  }

  list(): ProposedEdit[] {
    return [...this.edits.values()];
  }

  /** `list()` plus derived +/- line stats for each pending edit (for the Changes panel). */
  listWithStats(): Array<ProposedEdit & EditStats> {
    return this.list().map((e) => ({ ...e, ...this.stats(e.path) }));
  }

  paths(): string[] {
    return [...this.edits.keys()];
  }

  clear(): void {
    this.edits.clear();
    this._onDidChange.fire();
    this.schedulePersist();
  }

  delete(relPath: string): void {
    this.edits.delete(normalize(relPath));
    this._onDidChange.fire();
    this.schedulePersist();
  }

  async accept(workspaceRoot: string, relPath: string): Promise<void> {
    const edit = this.get(relPath);
    if (!edit) return;
    if (!edit.applied) {
      const abs = joinWorkspace(workspaceRoot, edit.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, edit.after, "utf8");
    }
    this.delete(relPath);
  }

  async acceptAll(workspaceRoot: string): Promise<number> {
    const paths = this.paths();
    for (const p of paths) await this.accept(workspaceRoot, p);
    return paths.length;
  }

  async reject(relPath: string, workspaceRoot?: string): Promise<void> {
    const edit = this.get(relPath);
    if (edit?.applied && workspaceRoot) {
      await this.revertApplied(workspaceRoot, edit);
      this.delete(relPath);
      return;
    }
    this.delete(relPath);
  }

  /** Restore pre-edit content for an already-applied change. */
  async revertApplied(workspaceRoot: string, edit: ProposedEdit): Promise<void> {
    const abs = joinWorkspace(workspaceRoot, edit.path);
    if (edit.before === "") {
      try {
        await fs.unlink(abs);
      } catch {
        // already gone
      }
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, edit.before, "utf8");
    }
  }

  async rejectAll(workspaceRoot?: string): Promise<void> {
    const paths = this.paths();
    for (const p of paths) await this.reject(p, workspaceRoot);
  }

  /** Hunks remaining between the working baseline and the fully-proposed content. */
  getHunks(relPath: string): Hunk[] {
    const edit = this.get(relPath);
    if (!edit) return [];
    return computeHunks(edit.current, edit.after);
  }

  stats(relPath: string): EditStats {
    const hunks = this.getHunks(relPath);
    let additions = 0;
    let deletions = 0;
    for (const h of hunks) {
      additions += h.afterLines.length;
      deletions += h.currentLines.length;
    }
    return { additions, deletions };
  }

  /** Accept just one hunk: writes the narrowed result to disk immediately. */
  async acceptHunk(workspaceRoot: string, relPath: string, hunkId: string): Promise<boolean> {
    const key = normalize(relPath);
    const edit = this.edits.get(key);
    if (!edit) return false;
    const hunk = computeHunks(edit.current, edit.after).find((h) => h.id === hunkId);
    if (!hunk) return false;

    const currentLines = edit.current.split("\n");
    const newCurrent = [
      ...currentLines.slice(0, hunk.currentStart),
      ...hunk.afterLines,
      ...currentLines.slice(hunk.currentStart + hunk.currentLines.length),
    ].join("\n");

    const abs = joinWorkspace(workspaceRoot, edit.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, newCurrent, "utf8");

    if (newCurrent === edit.after) {
      this.edits.delete(key);
    } else {
      this.edits.set(key, { ...edit, current: newCurrent });
    }
    this._onDidChange.fire();
    this.schedulePersist();
    return true;
  }

  /** Reject just one hunk: narrows the proposed target back to the current baseline for that range. */
  rejectHunk(relPath: string, hunkId: string): boolean {
    const key = normalize(relPath);
    const edit = this.edits.get(key);
    if (!edit) return false;
    const hunk = computeHunks(edit.current, edit.after).find((h) => h.id === hunkId);
    if (!hunk) return false;

    const afterLines = edit.after.split("\n");
    const newAfter = [
      ...afterLines.slice(0, hunk.afterStart),
      ...hunk.currentLines,
      ...afterLines.slice(hunk.afterStart + hunk.afterLines.length),
    ].join("\n");

    if (newAfter === edit.current) {
      this.edits.delete(key);
    } else {
      this.edits.set(key, { ...edit, after: newAfter });
    }
    this._onDidChange.fire();
    this.schedulePersist();
    return true;
  }
}

export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly store: ProposedEditsStore) {
    store.onDidChange(() => {
      for (const e of store.list()) {
        this._onDidChange.fire(uriFor(e.path, "after"));
        this._onDidChange.fire(uriFor(e.path, "before"));
      }
    });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // ninjacode-proposed:/before/path or /after/path
    const parts = uri.path.replace(/^\//, "").split("/");
    const side = parts[0];
    const rel = parts.slice(1).join("/");
    const edit = this.store.get(rel);
    if (!edit) return "";
    // "before" reflects the current working baseline (which narrows as hunks are
    // accepted/rejected), so the diff view always shows exactly what's left to review.
    return side === "before" ? edit.current : edit.after;
  }
}

function uriFor(relPath: string, side: "before" | "after"): vscode.Uri {
  return vscode.Uri.parse(`ninjacode-proposed:/${side}/${relPath.replace(/\\/g, "/")}`);
}

export async function showProposedDiff(relPath: string): Promise<void> {
  const left = uriFor(relPath, "before");
  const right = uriFor(relPath, "after");
  await vscode.commands.executeCommand(
    "vscode.diff",
    left,
    right,
    `NinjaCode: ${relPath}`,
  );
}
