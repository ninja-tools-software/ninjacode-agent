import * as vscode from "vscode";
import { appendSessionNote } from "@ninjacode/core";
import { t } from "../locale.js";
import type { ProposedEdit, ProposedEditsStore } from "../proposedEdits.js";
import { showProposedDiff } from "../proposedEdits.js";
import type { ChatCore } from "./chatCore.js";
import { buildChangesPayload } from "./sessionHydrator.js";

interface EditsControllerDeps {
  core: ChatCore;
  store: ProposedEditsStore;
}

/**
 * The Changes panel: proposed/applied edits, hunk-level accept/reject, and the
 * auto-accept countdown.
 */
export class EditsController {
  private autoAcceptTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly deps: EditsControllerDeps) {}

  dispose(): void {
    this.cancelAutoAccept(false);
  }

  private get core(): ChatCore {
    return this.deps.core;
  }

  /** Wire the store to `.ninjacode/proposed-edits.json` and restore anything left
   * pending from before a reload (e.g. the extension host restarting). */
  configurePersistence(): void {
    const dir = this.core.agentDir();
    if (!dir) return;
    this.deps.store.configure(dir, this.core.workspaceRoot());
    void this.deps.store.restore();
  }

  /** Broadcast the current edit set, then re-arm the auto-accept countdown. */
  publish(): void {
    const paths = this.deps.store.paths();
    this.core.post(undefined, { type: "pending_edits", paths });
    if (this.core.activeSessionId) {
      this.core.post(this.core.activeSessionId, { type: "pending_edits", paths });
    }
    this.core.post(undefined, { type: "changes", changes: buildChangesPayload(this.deps.store) });
    this.scheduleAutoAccept();
  }

  /** Restart the countdown from scratch; disabled when any edit is sensitive. */
  private scheduleAutoAccept(): void {
    this.cancelAutoAccept(false);
    const delayMs =
      vscode.workspace.getConfiguration("ninjacode").get<number>("autoAcceptEditsDelayMs") ?? 0;
    const edits = this.deps.store.list();
    if (delayMs <= 0 || edits.length === 0 || edits.some((e) => e.sensitive)) {
      this.core.post(undefined, { type: "auto_accept", deadline: null });
      return;
    }
    this.core.post(undefined, { type: "auto_accept", deadline: Date.now() + delayMs });
    this.autoAcceptTimer = setTimeout(() => {
      this.autoAcceptTimer = undefined;
      void this.acceptAll();
    }, delayMs);
  }

  cancelAutoAccept(notify = true): void {
    if (this.autoAcceptTimer) {
      clearTimeout(this.autoAcceptTimer);
      this.autoAcceptTimer = undefined;
    }
    if (notify) this.core.post(undefined, { type: "auto_accept", deadline: null });
  }

  async review(relPath: string): Promise<void> {
    await showProposedDiff(relPath);
  }

  async acceptAll(): Promise<void> {
    const root = this.core.workspaceRoot();
    if (!root) return;
    const n = await this.deps.store.acceptAll(root);
    vscode.window.showInformationMessage(t("Accepted {0} edit(s).", n));
  }

  async rejectAll(): Promise<void> {
    const rejected = this.deps.store.list();
    await this.deps.store.rejectAll(this.core.workspaceRoot());
    await this.noteRejected(rejected);
  }

  async accept(relPath: string): Promise<void> {
    const root = this.core.workspaceRoot();
    if (root) await this.deps.store.accept(root, relPath);
  }

  async reject(relPath: string): Promise<void> {
    const edit = this.deps.store.get(relPath);
    await this.deps.store.reject(relPath, this.core.workspaceRoot());
    if (edit) await this.noteRejected([edit]);
  }

  postHunks(relPath: string): void {
    this.core.post(undefined, { type: "hunks", path: relPath, hunks: this.deps.store.getHunks(relPath) });
  }

  async acceptHunk(relPath: string, hunkId: string): Promise<void> {
    const root = this.core.workspaceRoot();
    if (root) await this.deps.store.acceptHunk(root, relPath, hunkId);
  }

  rejectHunk(relPath: string, hunkId: string): void {
    this.deps.store.rejectHunk(relPath, hunkId);
  }

  /**
   * Tell the (idle) session behind some rejected edits that the user reverted them, so a
   * resumed agent re-reads those files instead of trusting its own last write.
   */
  private async noteRejected(edits: ProposedEdit[]): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir || edits.length === 0) return;
    const bySession = new Map<string, string[]>();
    for (const e of edits) {
      const sid = e.sessionId ?? this.core.activeSessionId;
      if (!sid) continue;
      bySession.set(sid, [...(bySession.get(sid) ?? []), e.path]);
    }
    for (const [sid, paths] of bySession) {
      const list = paths.map((p) => `\`${p}\``).join(", ");
      await appendSessionNote(
        dir,
        sid,
        `The user rejected the proposed edit(s) to ${list}; those files were reverted to their previous contents. Re-read them before making further changes.`,
      ).catch(() => undefined);
    }
  }
}
