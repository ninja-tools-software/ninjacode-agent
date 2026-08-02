import * as vscode from "vscode";
import path from "node:path";
import { planContentForDisplay, parsePlanHeader } from "@ninjacode/tools";
import type { SettingsPayload } from "./protocol.js";
import { renderWebviewHtml } from "./webviewHtml.js";

export const PLAN_EDITOR_VIEW_TYPE = "ninjacode.planEditor";

interface PlanEditorDeps {
  activeSessionId(): string | undefined;
  isBusy(): boolean;
  settingsPayload(): Promise<SettingsPayload>;
  executePlan(sessionId: string | undefined, model?: string, planId?: string): Promise<void>;
  setModel(model: string): Promise<void>;
  openMarkdownPreview(file: string): Promise<void>;
}

interface PlanEditorBinding {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  planId: string;
  disposables: vscode.Disposable[];
}

function planIdFromPath(filePath: string): string | undefined {
  return filePath.match(/_([a-f0-9]{8})\.plan\.md$/i)?.[1];
}

function relPathForDocument(document: vscode.TextDocument): string {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return document.uri.fsPath;
  return path.relative(folder.uri.fsPath, document.uri.fsPath).split(path.sep).join("/");
}

function titleFromPlan(content: string, fallback: string): string {
  const header = parsePlanHeader(content);
  if (header?.title) return header.title;
  const match = planContentForDisplay(content).match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallback;
}

function planMetaFromDocument(document: vscode.TextDocument): {
  planId: string;
  title: string;
  relPath: string;
} {
  const content = document.getText();
  const header = parsePlanHeader(content);
  const planId = header?.id ?? planIdFromPath(document.uri.fsPath) ?? "unknown";
  return {
    planId,
    title: titleFromPlan(content, "Plan"),
    relPath: relPathForDocument(document),
  };
}

/**
 * Custom editor for `.ninjacode/plans/*.plan.md` — opens by default from the
 * Explorer and renders the PlanApp webview (read-only, toolbar + Execute plan).
 */
export class PlanEditorProvider implements vscode.CustomTextEditorProvider {
  /** planId → open webview bindings (normally one per file). */
  private readonly editors = new Map<string, Set<PlanEditorBinding>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: PlanEditorDeps,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const meta = planMetaFromDocument(document);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"),
      ],
    };
    webviewPanel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, "media", "icon-light.svg"),
      dark: vscode.Uri.joinPath(this.context.extensionUri, "media", "icon-dark.svg"),
    };
    webviewPanel.webview.html = renderWebviewHtml(
      webviewPanel.webview,
      this.context.extensionUri,
      "plan",
    );
    webviewPanel.title = meta.title;

    const binding: PlanEditorBinding = {
      panel: webviewPanel,
      document,
      planId: meta.planId,
      disposables: [],
    };

    binding.disposables.push(
      webviewPanel.webview.onDidReceiveMessage((msg) =>
        void this.onMessage(binding, msg as { type?: string; model?: string }),
      ),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString()) return;
        void this.postDoc(binding);
      }),
      webviewPanel.onDidDispose(() => this.unregister(binding)),
    );

    this.register(binding);
    await this.postDoc(binding);
  }

  /** Refresh every open custom editor showing this plan (content, models, busy). */
  async refreshForPlan(planId: string): Promise<void> {
    const bindings = this.editors.get(planId);
    if (!bindings) return;
    await Promise.all([...bindings].map((b) => this.postDoc(b)));
  }

  /** Refresh all open plan editors (e.g. after settings change). */
  async refreshAll(): Promise<void> {
    await Promise.all([...this.editors.keys()].map((id) => this.refreshForPlan(id)));
  }

  private register(binding: PlanEditorBinding): void {
    let set = this.editors.get(binding.planId);
    if (!set) {
      set = new Set();
      this.editors.set(binding.planId, set);
    }
    set.add(binding);
  }

  private unregister(binding: PlanEditorBinding): void {
    for (const d of binding.disposables.splice(0)) d.dispose();
    const set = this.editors.get(binding.planId);
    if (!set) return;
    set.delete(binding);
    if (set.size === 0) this.editors.delete(binding.planId);
  }

  private post(panel: vscode.WebviewPanel, payload: Record<string, unknown>): void {
    void panel.webview.postMessage(payload);
  }

  private async postDoc(binding: PlanEditorBinding): Promise<void> {
    const content = binding.document.getText();
    const meta = planMetaFromDocument(binding.document);
    binding.planId = meta.planId;
    binding.panel.title = meta.title;
    const settings = await this.deps.settingsPayload();
    this.post(binding.panel, {
      type: "plan_doc",
      planId: meta.planId,
      title: meta.title,
      relPath: meta.relPath,
      content: planContentForDisplay(content),
      models: settings.models,
      model: settings.model,
      busy: this.deps.isBusy(),
    });
  }

  private async onMessage(
    binding: PlanEditorBinding,
    msg: { type?: string; model?: string },
  ): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.postDoc(binding);
        return;
      case "execute_plan":
        await this.deps.executePlan(this.deps.activeSessionId(), msg.model, binding.planId);
        return;
      case "set_model":
        if (msg.model) await this.deps.setModel(msg.model);
        await this.postDoc(binding);
        return;
      case "open_plan_markdown":
        await this.deps.openMarkdownPreview(binding.document.uri.fsPath);
        return;
      default:
        return;
    }
  }
}
