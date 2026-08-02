import * as vscode from "vscode";
import path from "node:path";
import { CodebaseIndex } from "@ninjacode/tools";

/**
 * Lazily builds (once) and caches a local codebase index per workspace root, kept
 * fresh by a watcher that incrementally refreshes/removes single files instead of
 * re-scanning everything.
 */
export class CodebaseIndexService {
  private readonly indexes = new Map<string, CodebaseIndex>();
  private readonly builds = new Map<string, Promise<CodebaseIndex>>();
  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();

  constructor(private readonly subscriptions: vscode.Disposable[]) {}

  async getOrCreate(workspaceRoot: string): Promise<CodebaseIndex> {
    const existing = this.indexes.get(workspaceRoot);
    if (existing) return existing;
    const inFlight = this.builds.get(workspaceRoot);
    if (inFlight) return inFlight;

    const build = (async () => {
      const index = new CodebaseIndex(workspaceRoot);
      await index.build();
      this.indexes.set(workspaceRoot, index);
      this.watch(workspaceRoot, index);
      return index;
    })();
    this.builds.set(workspaceRoot, build);
    try {
      return await build;
    } finally {
      this.builds.delete(workspaceRoot);
    }
  }

  /** The already-built index for a root, if any — never triggers a build. */
  peek(workspaceRoot: string): CodebaseIndex | undefined {
    return this.indexes.get(workspaceRoot);
  }

  private watch(workspaceRoot: string, index: CodebaseIndex): void {
    if (this.watchers.has(workspaceRoot)) return;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(workspaceRoot), "**/*"),
    );
    const toRel = (uri: vscode.Uri) => path.relative(workspaceRoot, uri.fsPath).replace(/\\/g, "/");
    watcher.onDidCreate((uri) => void index.refreshFile(toRel(uri)));
    watcher.onDidChange((uri) => void index.refreshFile(toRel(uri)));
    watcher.onDidDelete((uri) => index.removeFile(toRel(uri)));
    this.watchers.set(workspaceRoot, watcher);
    this.subscriptions.push(watcher);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
  }
}
