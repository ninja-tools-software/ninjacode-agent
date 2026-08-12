import * as vscode from "vscode";
import { t } from "../locale.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Agent,
  CheckpointManager,
  checkpointIdForUserMessageOrdinal,
  deleteSession,
  exportSessionAsJson,
  exportSessionAsMarkdown,
  forkSession,
  listSessions,
  loadSession,
  loadSessionSafe,
  renameSession,
  setSessionFlags,
  truncateSessionAtUserMessageOrdinal,
  type AgentMode,
  type PersistedSession,
} from "@ninjacode/core";
import { getModelInfo, type ProviderKind } from "@ninjacode/providers";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import type { ProposedEditsStore } from "../proposedEdits.js";
import type { ChatCore } from "./chatCore.js";
import type { McpService } from "./mcpService.js";
import { buildChangesPayload, buildHydratePayload, historyToUiLog } from "./sessionHydrator.js";
import { seedSessionUsage } from "./sessionUsage.js";

/** Restore a session's running token totals from what core persisted for it. */
function usageFromPersisted(saved: PersistedSession) {
  return seedSessionUsage(saved.totalUsage, saved.turns.length, {
    provider: saved.config.provider,
    model: saved.config.model,
  });
}

interface SessionsControllerDeps {
  core: ChatCore;
  proposedEdits: ProposedEditsStore;
  mcp: McpService;
  syncPlanPanel(sessionId: string | undefined): Promise<void>;
  clearPlan(): void;
  clearTodos(): Promise<void>;
  closeMcp(): Promise<void>;
  pushSettings(): Promise<void>;
  runMessage(sessionId: string | undefined, text: string): Promise<void>;
  /** Whether the one-shot "hold Shift to drag" hint is still pending. */
  showDragTip(): boolean;
  /** Whether the user already skipped the welcome screen. */
  onboardingDismissed(): boolean;
}

/** Everything that creates, lists, switches, forks, renames, exports or deletes a conversation. */
export class SessionsController {
  constructor(private readonly deps: SessionsControllerDeps) {}

  private get core(): ChatCore {
    return this.deps.core;
  }

  async pushSessions(): Promise<void> {
    const dir = this.core.agentDir();
    this.core.post(undefined, { type: "sessions_loading", loading: true });
    try {
      const sessions = dir ? await listSessions(dir) : [];
      this.core.sessionsList = sessions;
      this.core.post(undefined, {
        type: "sessions",
        sessions,
        activeSessionId: this.core.activeSessionId,
      });
    } finally {
      this.core.post(undefined, { type: "sessions_loading", loading: false });
    }
  }

  pushQueue(sessionId: string): void {
    this.core.post(sessionId, { type: "queue", queue: this.core.runtimes.get(sessionId)?.queue ?? [] });
  }

  pushChanges(): void {
    this.core.post(undefined, { type: "changes", changes: buildChangesPayload(this.deps.proposedEdits) });
  }

  /** Re-send the full hydrate payload for whatever session is currently active. */
  hydrateActive(): void {
    const sid = this.core.activeSessionId;
    const runtime = sid ? this.core.runtimes.get(sid) : undefined;
    this.core.post(undefined, {
      type: "hydrate",
      ...buildHydratePayload({
        runtime,
        activeSessionId: sid,
        sessions: this.core.sessionsList,
        pendingEdits: this.deps.proposedEdits.paths(),
        showDragTip: this.deps.showDragTip(),
        onboardingDismissed: this.deps.onboardingDismissed(),
      }),
    });
    if (sid && !runtime?.ui.contextUsage && (runtime?.ui.log.length ?? 0) > 0) {
      void this.refreshContextUsage(sid);
    }
    this.pushChanges();
  }

  newSession(): void {
    this.core.activeSessionId = undefined;
    this.deps.proposedEdits.clear();
    void this.deps.closeMcp();
    void this.deps.clearTodos();
    this.core.post(undefined, { type: "clear" });
    this.deps.clearPlan();
    this.core.post(undefined, { type: "session_changed", activeSessionId: undefined });
    this.core.post(undefined, { type: "status", text: "New session started." });
    void this.pushSessions();
  }

  async switchSession(sessionId: string): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) {
      this.core.post(undefined, { type: "error", text: "Open a workspace folder first." });
      return;
    }
    this.core.post(undefined, { type: "sessions_loading", loading: true });
    try {
      let runtime = this.core.runtimes.get(sessionId);
      let saved: PersistedSession | null = null;
      if (!runtime) {
        saved = await loadSessionSafe(dir, sessionId);
        if (!saved) {
          vscode.window.showWarningMessage(t("Session not found."));
          await this.pushSessions();
          return;
        }
        runtime = this.core.runtimes.seedUi(sessionId, {
          log: historyToUiLog(saved.history),
          todos: [],
          pendingEdits: this.deps.proposedEdits.paths(),
          hypotheses: [],
          debugLogCount: 0,
          sessionUsage: usageFromPersisted(saved),
        });
        await this.adoptSessionConfig(saved);
      }

      this.core.activeSessionId = sessionId;
      if (!runtime.ui.contextUsage) await this.refreshContextUsage(sessionId, saved ?? undefined);

      this.core.post(undefined, {
        type: "hydrate",
        ...buildHydratePayload({
          runtime,
          activeSessionId: sessionId,
          sessions: this.core.sessionsList,
          pendingEdits: this.deps.proposedEdits.paths(),
        }),
      });
      this.core.post(undefined, { type: "session_changed", activeSessionId: sessionId });
      await this.deps.syncPlanPanel(sessionId);
      this.pushChanges();
      await this.pushSessions();
      await this.deps.pushSettings();
    } finally {
      this.core.post(undefined, { type: "sessions_loading", loading: false });
    }
  }

  /** Re-opening a conversation restores the mode/model it ran with. */
  private async adoptSessionConfig(saved: PersistedSession): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    if (saved.config.mode) await cfg.update("mode", saved.config.mode, vscode.ConfigurationTarget.Workspace);
    if (saved.config.model) await cfg.update("model", saved.config.model, vscode.ConfigurationTarget.Workspace);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) return;
    const deleteLabel = t("Delete");
    const confirm = await vscode.window.showWarningMessage(
      t("Delete this conversation permanently?"),
      { modal: true },
      deleteLabel,
    );
    if (confirm !== deleteLabel) return;
    this.core.runtimes.clear(sessionId);
    await deleteSession(dir, sessionId);
    if (this.core.activeSessionId === sessionId) this.newSession();
    else await this.pushSessions();
  }

  /** Clone a conversation up to (and including) one exchange, then switch to it. */
  async fork(sourceSessionId: string, uptoUserMessageOrdinal?: number): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) return;
    const forked = await forkSession(dir, sourceSessionId, { uptoUserMessageOrdinal });
    if (!forked) {
      vscode.window.showWarningMessage(t("Could not fork this conversation."));
      return;
    }
    await this.pushSessions();
    await this.switchSession(forked.config.id);
    vscode.window.showInformationMessage(t("Forked conversation into a new session."));
  }

  /**
   * Truncate the session at `messageIndex` (dropping that message onward), best-effort
   * restore the checkpoint captured just before it, then resend the edited text.
   */
  async editAndResend(sessionId: string, messageIndex: number, newText: string): Promise<void> {
    const dir = this.core.agentDir();
    const root = this.core.workspaceRoot();
    if (!dir || !root) return;
    if (this.core.runtimes.isBusy(sessionId)) {
      vscode.window.showWarningMessage(t("Stop the current run before editing a previous message."));
      return;
    }

    // Resolve the checkpoint from the session's own request map *before* truncating,
    // rather than indexing the workspace-global checkpoint list — which mixes sessions
    // and could reset the workspace to an unrelated snapshot.
    const original = await loadSession(dir, sessionId);
    const checkpointId = original ? checkpointIdForUserMessageOrdinal(original, messageIndex) : null;

    const truncated = await truncateSessionAtUserMessageOrdinal(dir, sessionId, messageIndex);
    if (!truncated) {
      vscode.window.showWarningMessage(t("Could not find that message to edit."));
      return;
    }

    if (checkpointId) {
      try {
        await new CheckpointManager(root, dir).restore(checkpointId);
      } catch {
        // Best effort — resend even if the restore fails.
      }
    }

    const runtime = this.core.runtimes.seedUi(sessionId, {
      log: historyToUiLog(truncated.history),
      todos: [],
      pendingEdits: this.deps.proposedEdits.paths(),
      hypotheses: [],
      debugLogCount: 0,
      contextUsage: null,
      sessionUsage: usageFromPersisted(truncated),
    });
    this.core.activeSessionId = sessionId;
    this.core.post(undefined, {
      type: "hydrate",
      ...buildHydratePayload({
        runtime,
        activeSessionId: sessionId,
        sessions: this.core.sessionsList,
        pendingEdits: runtime.ui.pendingEdits,
        showDragTip: this.deps.showDragTip(),
        onboardingDismissed: this.deps.onboardingDismissed(),
      }),
    });
    await this.deps.runMessage(sessionId, newText);
  }

  async rename(sessionId: string, title: string): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) return;
    await renameSession(dir, sessionId, title);
    await this.pushSessions();
  }

  async setFlags(sessionId: string, flags: { pinned?: boolean; archived?: boolean }): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) return;
    await setSessionFlags(dir, sessionId, flags);
    await this.pushSessions();
  }

  async exportToFile(sessionId: string, format: "json" | "markdown"): Promise<void> {
    const dir = this.core.agentDir();
    if (!dir) return;
    const saved = await loadSession(dir, sessionId);
    if (!saved) {
      vscode.window.showWarningMessage(t("Conversation not found."));
      return;
    }
    const content = format === "json" ? exportSessionAsJson(saved) : exportSessionAsMarkdown(saved);
    const ext = format === "json" ? "json" : "md";
    const safeName =
      (saved.title ?? "conversation").replace(/[^\w.-]+/g, "_").slice(0, 60) || "conversation";
    const folder = vscode.workspace.workspaceFolders?.[0];
    const uri = await vscode.window.showSaveDialog({
      defaultUri: folder
        ? vscode.Uri.joinPath(folder.uri, `${safeName}.${ext}`)
        : vscode.Uri.file(`${safeName}.${ext}`),
      filters: format === "json" ? { JSON: ["json"] } : { Markdown: ["md"] },
    });
    if (!uri) return;
    await fs.writeFile(uri.fsPath, content, "utf8");
    vscode.window.showInformationMessage(t("Exported conversation to {0}.", path.basename(uri.fsPath)));
  }

  /** Estimate and publish context usage (e.g. after loading a session from disk). */
  async refreshContextUsage(sessionId: string, saved?: PersistedSession): Promise<void> {
    const root = this.core.workspaceRoot();
    const runtime = this.core.runtimes.get(sessionId);
    if (!root || !runtime) return;

    try {
      const usage = runtime.agent
        ? await runtime.agent.previewContextUsage()
        : await this.estimateFromDisk(root, sessionId, saved);
      if (usage) this.core.post(sessionId, { type: "context_usage", ...usage });
    } catch {
      // Best effort — the meter stays hidden if estimation fails.
    }
  }

  private async estimateFromDisk(
    root: string,
    sessionId: string,
    saved?: PersistedSession,
  ): Promise<Awaited<ReturnType<typeof Agent.estimateContextForSession>> | undefined> {
    const agentDir = path.join(root, ".ninjacode");
    const session = saved ?? (await loadSessionSafe(agentDir, sessionId));
    if (!session || session.history.length === 0) return undefined;

    const tools = createDefaultToolRegistry();
    for (const t of await this.deps.mcp.tools(root)) tools.register(t);

    return Agent.estimateContextForSession(
      buildContextEstimateArgs(root, agentDir, session, tools),
    );
  }
}

function buildContextEstimateArgs(
  root: string,
  agentDir: string,
  session: PersistedSession,
  tools: ReturnType<typeof createDefaultToolRegistry>,
): Parameters<typeof Agent.estimateContextForSession>[0] {
  const cfg = vscode.workspace.getConfiguration("ninjacode");
  const kind = cfg.get<ProviderKind>("provider") ?? "anthropic";
  const model = session.config.model ?? (cfg.get<string>("model") || undefined);
  const configuredWindow = cfg.get<number>("contextWindow") ?? 0;
  const modelInfo = getModelInfo(kind, model ?? "");
  return {
    workspaceRoot: root,
    agentDir,
    mode: session.config.mode ?? cfg.get<AgentMode>("mode") ?? "agent",
    history: session.history,
    tools,
    contextWindow:
      configuredWindow > 0
        ? Math.min(configuredWindow, modelInfo?.contextWindow ?? configuredWindow)
        : modelInfo?.contextWindow,
    maxTokens: modelInfo?.maxOutput ?? 8192,
    providerKind: kind,
    model,
  };
}
