import * as vscode from "vscode";
import path from "node:path";
import { normalizeRulePath } from "@ninjacode/core";
import type { SettingsMessage, SettingsService } from "./settingsService.js";
import { renderWebviewHtml } from "./webviewHtml.js";
import { WorkspaceAssetsService, type AssetMessage } from "./workspaceAssetsService.js";

/**
 * NinjaCode Settings as a full-width editor tab. VS Code's native settings UI
 * only renders declarative inputs, so everything that needs real UI (credits
 * gauge, live model lists, API keys, MCP status) lives here — while still
 * reading and writing the same `ninjacode.*` configuration keys, which keeps
 * the native settings editor a valid second view on the simple preferences.
 */
export class SettingsPanel {
  static readonly viewType = "ninjacode.settings";
  private static current?: SettingsPanel;

  private readonly disposables: vscode.Disposable[] = [];
  private readonly assets: WorkspaceAssetsService;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  /** Drop stale settings posts when a newer refresh started while awaiting the gateway. */
  private settingsPushGen = 0;

  static show(context: vscode.ExtensionContext, service: SettingsService): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(column);
      void SettingsPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      SettingsPanel.viewType,
      "NinjaCode Settings",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          context.extensionUri,
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
        ],
      },
    );
    SettingsPanel.current = new SettingsPanel(panel, context, service);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    private readonly service: SettingsService,
  ) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "icon-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "icon-dark.svg"),
    };
    panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, "settings");

    this.assets = new WorkspaceAssetsService({
      refresh: () => this.pushExtras(),
      reloadMcp: () => service.reloadMcp(),
      post: (payload) => this.post(payload),
    });

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: SettingsMessage & AssetMessage) =>
        this.onMessage(msg),
      ),
      // Keep in sync with the chat view and with edits made in the native
      // settings editor (both funnel through the service).
      service.onDidChange(() => {
        void this.refresh();
      }),
      this.watchAssetFiles(),
    );
    panel.onDidDispose(() => this.dispose());
  }

  /** Reflect asset files edited outside the panel (in an editor, by the agent, by git). */
  private watchAssetFiles(): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(
      "**/{.ninjacode,.claude,.github,.agents,.cursor}/**/*.{md,mdc,json}",
    );
    const onChange = () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        void this.pushExtras();
      }, 300);
    };
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);
    return watcher;
  }

  private dispose(): void {
    SettingsPanel.current = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  private async onMessage(msg: SettingsMessage & AssetMessage): Promise<void> {
    if (WorkspaceAssetsService.handles(msg.type)) {
      await this.assets.handleMessage(msg);
      return;
    }
    switch (msg.type) {
      case "ready":
      case "get_settings":
        await this.refresh();
        return;
      case "get_mcp_status":
        // Explicit reload: drop the cached clients so servers really reconnect.
        await this.service.reloadMcp();
        await this.pushExtras();
        return;
      case "get_agent_logs":
        this.post({ type: "agent_logs", entries: this.service.agentLogs() });
        return;
      default:
        await this.service.handleMessage(msg);
    }
  }

  private post(payload: Record<string, unknown>): void {
    void this.panel.webview.postMessage(payload);
  }

  private async refresh(): Promise<void> {
    const gen = ++this.settingsPushGen;
    const payload = await this.service.buildPayload();
    if (gen !== this.settingsPushGen) return;
    this.post({ type: "settings", ...payload });
    await this.pushExtras();
    this.post({ type: "agent_logs", entries: this.service.agentLogs() });
  }

  private async pushExtras(): Promise<void> {
    const extras = await this.service.loadExtras();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const rel = (p: string) =>
      (root ? path.relative(root, p) : p).split(path.sep).join("/");

    this.post({
      type: "mcp_status",
      servers: extras.mcpServers,
      configFile: extras.mcpConfigFile,
    });
    this.post({
      type: "skills",
      items: extras.skills.map((s) => ({
        name: s.name,
        description: s.description,
        context: s.context,
        allowedTools: s.allowedTools,
        source: s.source,
        enabled: s.enabled,
        path: rel(s.skillFile),
      })),
    });
    this.post({
      type: "custom_agents",
      items: extras.customAgents.map((a) => ({
        name: a.name,
        description: a.description,
        model: a.model,
        tools: a.tools,
        systemPrompt: a.systemPrompt,
        source: a.source,
        enabled: a.enabled,
        path: rel(a.path),
      })),
    });
    this.post({
      type: "rules",
      items: extras.rules.map((r) => ({
        kind: r.kind,
        path: normalizeRulePath(r.path),
        included: r.included,
        reason: r.reason,
        globs: r.globs,
        chars: r.chars,
        enabled: r.reason !== "disabled in settings",
      })),
    });
  }
}
