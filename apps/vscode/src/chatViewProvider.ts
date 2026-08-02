import * as vscode from "vscode";
import { t } from "./locale.js";
import path from "node:path";
import {
  appendSessionNote,
  loadPrompts,
  type Checkpoint,
  type PromptDefinition,
} from "@ninjacode/core";
import type { CodebaseIndex } from "@ninjacode/tools";
import type { ContextRef } from "./protocol.js";
import { SettingsService } from "./settingsService.js";
import { renderWebviewHtml } from "./webviewHtml.js";
import { ProposedEditsStore } from "./proposedEdits.js";
import { ChatCore } from "./chat/chatCore.js";
import { CodebaseIndexService } from "./chat/codebaseIndexService.js";
import { PlanEditorProvider } from "./planEditorProvider.js";
import { wireChatView } from "./chat/chatViewWiring.js";
import { isGatewayCreditsError } from "./chat/gatewayCreditsError.js";

/** Built-in slash commands always offered in the composer's `/` autocomplete,
 * on top of any project/user prompts discovered via `loadPrompts`. */
const BUILTIN_SLASH_COMMANDS = [
  { name: "new", description: "Start a new conversation" },
  { name: "compact", description: "Compact the current conversation history" },
  { name: "fork", description: "Duplicate this conversation into a new session" },
  { name: "review", description: "Review recent changes for bugs and quality issues" },
  { name: "fix", description: "Investigate and fix a bug" },
  { name: "tests", description: "Write tests for the current change" },
  { name: "docs", description: "Write or update documentation" },
  { name: "agents", description: "List available custom agents" },
  { name: "skills", description: "List available skills" },
];

/**
 * Owns the chat webview and wires together the controllers that do the actual work:
 * sessions, proposed edits, context attachment, the agent run loop, plan/todos and
 * voice dictation. Anything longer than a few lines belongs in one of those, not here.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "ninjacode.chatView";
  public static readonly viewTypeLeft = "ninjacode.chatViewLeft";

  readonly proposedEdits = new ProposedEditsStore();
  private readonly core = new ChatCore();
  private readonly settingsService: SettingsService;
  private readonly indexes: CodebaseIndexService;
  readonly planEditor: PlanEditorProvider;
  private readonly plan: ReturnType<typeof wireChatView>["plan"];
  private readonly sessions: ReturnType<typeof wireChatView>["sessions"];
  private readonly edits: ReturnType<typeof wireChatView>["edits"];
  private readonly messageFlow: ReturnType<typeof wireChatView>["messageFlow"];
  private readonly voice: ReturnType<typeof wireChatView>["voice"];
  private readonly mcp: ReturnType<typeof wireChatView>["mcp"];
  private readonly route: ReturnType<typeof wireChatView>["route"];

  private recentFiles: string[] = [];
  /** Drop stale settings posts when a newer refresh started while awaiting the gateway. */
  private settingsPushGen = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    const wiring = wireChatView({
      context,
      core: this.core,
      proposedEdits: this.proposedEdits,
      recentFiles: () => this.recentFiles,
      codebaseIndex: (root) => this.codebaseIndex(root),
      friendlyRunError: (m) => this.friendlyRunError(m),
      pushSettings: () => this.pushSettings(),
      pushExtras: () => this.pushExtras(),
      stopActiveSession: () => {
        this.stopActiveSession();
      },
      withActiveSession: (fn) => this.withActiveSession(fn),
      resolveApproval: (requestId, approved, remember) =>
        this.resolveApproval(requestId, approved, remember),
    });

    this.settingsService = wiring.settingsService;
    this.indexes = wiring.indexes;
    this.planEditor = wiring.planEditor;
    this.plan = wiring.plan;
    this.sessions = wiring.sessions;
    this.edits = wiring.edits;
    this.messageFlow = wiring.messageFlow;
    this.voice = wiring.voice;
    this.mcp = wiring.mcp;
    this.route = wiring.route;

    this.proposedEdits.onDidChange(() => this.edits.publish());
    this.edits.configurePersistence();

    context.subscriptions.push(
      this.settingsService.onDidChange(() => {
        void this.pushSettings();
        void this.plan.syncEditorPanel();
        void this.planEditor.refreshAll();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.edits.configurePersistence()),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.trackRecentFile(editor)),
    );
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.core.view = webviewView;
    this.core.visible = webviewView.visible;
    webviewView.onDidChangeVisibility(() => {
      this.core.visible = webviewView.visible;
      if (webviewView.visible) this.core.view = webviewView;
      else void vscode.commands.executeCommand("setContext", "ninjacode.chatFocused", false);
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };
    webviewView.webview.html = renderWebviewHtml(
      webviewView.webview,
      this.context.extensionUri,
      "chat",
    );
    webviewView.webview.onDidReceiveMessage((msg) => void this.route(msg));
  }

  private withActiveSession(fn: (sessionId: string) => void): void {
    const sid = this.core.activeSessionId;
    if (sid) fn(sid);
  }

  private resolveApproval(requestId: string, approved: boolean, remember: boolean): void {
    this.withActiveSession((sid) =>
      this.core.runtimes.resolveApproval(sid, requestId, { approved, remember }),
    );
  }

  /** Turn a gateway insufficient_credits error into an actionable message. */
  private friendlyRunError(message: string): string {
    if (!isGatewayCreditsError(message)) return message;
    void vscode.window
      .showWarningMessage(t("NinjaCode: you're out of credits for this billing cycle."), t("Upgrade plan"))
      .then((choice) => {
        if (choice === t("Upgrade plan")) void this.settingsService.openSubscribe("pro");
      });
    return t("You've used all your monthly credits. They come back at your next renewal — or upgrade your plan to keep going now (Settings → Account).");
  }

  private trackRecentFile(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.uri.scheme !== "file") return;
    const root = this.core.workspaceRoot();
    if (!root) return;
    const rel = path.relative(root, editor.document.uri.fsPath);
    if (rel.startsWith("..")) return;
    this.recentFiles = [rel, ...this.recentFiles.filter((f) => f !== rel)].slice(0, 15);
  }

  private codebaseIndex(root: string): Promise<CodebaseIndex | undefined> {
    return this.indexes.getOrCreate(root).catch(() => undefined);
  }

  private async pushSettings(): Promise<void> {
    const gen = ++this.settingsPushGen;
    const payload = await this.settingsService.buildPayload();
    if (gen !== this.settingsPushGen) return;
    this.core.post(undefined, { type: "settings", ...payload });
  }

  /** Slash-command sources for the composer. MCP servers are connected here too so the
   * first agent run doesn't pay the handshake (their status shows up in Settings). */
  private async pushExtras(): Promise<void> {
    const root = this.core.workspaceRoot();
    if (!root) {
      this.core.post(undefined, { type: "slash_commands", builtins: BUILTIN_SLASH_COMMANDS, prompts: [] });
      return;
    }
    const [prompts] = await Promise.all([
      loadPrompts(root).catch(() => [] as PromptDefinition[]),
      this.mcp.ensure(root).catch(() => undefined),
    ]);
    this.core.post(undefined, {
      type: "slash_commands",
      builtins: BUILTIN_SLASH_COMMANDS,
      prompts: prompts.map((p) => ({
        name: p.name,
        description: p.description,
        argumentHint: p.argumentHint,
        body: p.body,
      })),
    });
  }

  get lastCheckpoints(): Checkpoint[] {
    const sid = this.core.activeSessionId;
    return sid ? this.core.runtimes.get(sid)?.checkpoints ?? [] : [];
  }

  get settings(): SettingsService {
    return this.settingsService;
  }

  isVisible(): boolean {
    return this.core.isVisible();
  }

  focusActiveChat(): Promise<void> {
    return this.core.focusChat();
  }

  newSession(): void {
    this.sessions.newSession();
  }

  async sendToChat(text: string, options?: { submit?: boolean }): Promise<void> {
    await this.core.focusChat();
    if (options?.submit === false) {
      this.core.post(undefined, { type: "compose", text });
      return;
    }
    await this.messageFlow.onUserMessage({ text });
  }

  async addContextToChat(refs: ContextRef[]): Promise<void> {
    if (refs.length === 0) return;
    await this.core.focusChat();
    this.core.post(undefined, { type: "context_insert", refs, at: "caret" });
  }

  stopActiveSession(): boolean {
    const sid = this.core.activeSessionId;
    return sid ? this.core.runtimes.stop(sid) : false;
  }

  acceptAllEdits(): Promise<void> {
    return this.edits.acceptAll();
  }

  openPlanEditor(): Promise<void> {
    return this.plan.openEditor(this.core.activeSessionId);
  }

  executePlan(model?: string): Promise<void> {
    return this.plan.execute(this.core.activeSessionId, model);
  }

  async restoreCheckpoint(): Promise<void> {
    const sid = this.core.activeSessionId;
    const runtime = sid ? this.core.runtimes.get(sid) : undefined;
    const checkpoints = runtime?.checkpoints ?? [];
    if (!runtime?.agent || checkpoints.length === 0) {
      vscode.window.showWarningMessage(t("No checkpoints available."));
      return;
    }
    const pick = await vscode.window.showQuickPick(
      checkpoints.map((c) => ({ label: c.label, description: c.createdAt, id: c.id })),
      { title: t("Restore checkpoint") },
    );
    if (!pick) return;
    await runtime.agent.getCheckpointManager().restore(pick.id);
    const dir = this.core.agentDir();
    if (dir && sid) {
      await appendSessionNote(
        dir,
        sid,
        `The user restored checkpoint "${pick.label}". Workspace files were reset to their state before that point — re-read any file before assuming its contents.`,
      ).catch(() => undefined);
    }
    vscode.window.showInformationMessage(t("Restored checkpoint {0}", pick.label));
  }

  async forkActiveSession(): Promise<void> {
    const sid = this.core.activeSessionId;
    if (!sid) {
      vscode.window.showWarningMessage(t("No active conversation to fork."));
      return;
    }
    await this.sessions.fork(sid);
  }

  async renameActiveSession(): Promise<void> {
    const sid = this.core.activeSessionId;
    if (!sid) {
      vscode.window.showWarningMessage(t("No active conversation."));
      return;
    }
    const current = this.core.sessionsList.find((s) => s.id === sid);
    const title = await vscode.window.showInputBox({
      title: t("Rename conversation"),
      value: current?.title ?? "",
      prompt: t("New title"),
    });
    if (title === undefined) return;
    await this.sessions.rename(sid, title);
  }

  async exportActiveSession(): Promise<void> {
    const sid = this.core.activeSessionId;
    if (!sid) {
      vscode.window.showWarningMessage(t("No active conversation."));
      return;
    }
    const format = await vscode.window.showQuickPick(
      [
        { label: t("Markdown"), value: "markdown" as const },
        { label: t("JSON"), value: "json" as const },
      ],
      { title: t("Export conversation as…") },
    );
    if (format) await this.sessions.exportToFile(sid, format.value);
  }

  async togglePinActiveSession(): Promise<void> {
    const sid = this.core.activeSessionId;
    if (!sid) return;
    const current = this.core.sessionsList.find((s) => s.id === sid);
    await this.sessions.setFlags(sid, { pinned: !current?.pinned });
  }

  async toggleArchiveActiveSession(): Promise<void> {
    const sid = this.core.activeSessionId;
    if (!sid) return;
    const current = this.core.sessionsList.find((s) => s.id === sid);
    await this.sessions.setFlags(sid, { archived: !current?.archived });
    if (current && !current.archived) this.sessions.newSession();
  }

  async handleAuthUri(uri: vscode.Uri): Promise<void> {
    const params = new URLSearchParams(uri.query);
    if (params.get("key")) {
      vscode.window.showErrorMessage(
        t("NinjaCode: legacy auth links with ?key= are no longer accepted. Sign in again from the website."),
      );
      return;
    }
    const code = params.get("code");
    if (!code) return;
    try {
      await this.settingsService.signInWithAuthCode(code);
      vscode.window.showInformationMessage(t("NinjaCode: signed in successfully."));
      await vscode.commands.executeCommand("ninjacode.openSettings");
    } catch (e) {
      vscode.window.showErrorMessage(t("NinjaCode: sign-in failed — {0}", (e as Error).message));
    }
  }

  async dispose(): Promise<void> {
    await this.mcp.close();
    this.core.runtimes.disposeAll();
    this.indexes.dispose();
    this.edits.dispose();
    this.proposedEdits.dispose();
    this.voice.dispose();
  }
}
