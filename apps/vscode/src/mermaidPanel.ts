import * as vscode from "vscode";
import { renderWebviewHtml } from "./webviewHtml.js";

/** Map a Mermaid diagram's first keyword to a short, human title for the panel tab. */
function titleFromSource(source: string): string {
  const firstLine = source.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
  const keyword = firstLine.split(/\s+/)[0]?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    flowchart: "Flowchart",
    graph: "Flowchart",
    sequencediagram: "Sequence Diagram",
    classdiagram: "Class Diagram",
    statediagram: "State Diagram",
    "statediagram-v2": "State Diagram",
    erdiagram: "ER Diagram",
    journey: "User Journey",
    gantt: "Gantt Chart",
    pie: "Pie Chart",
    quadrantchart: "Quadrant Chart",
    gitgraph: "Git Graph",
    mindmap: "Mindmap",
    timeline: "Timeline",
  };
  return known[keyword] ?? "Diagram";
}

/**
 * Opens a single Mermaid diagram from the chat in its own editor tab, rendered
 * full-size beside the chat/code. Mirrors `SettingsPanel`: one shared panel,
 * revealed and re-hydrated rather than duplicated on repeated clicks.
 */
export class MermaidPanel {
  static readonly viewType = "ninjacode.mermaid";
  private static current?: MermaidPanel;

  private readonly disposables: vscode.Disposable[] = [];
  private pendingSource: string;

  static show(context: vscode.ExtensionContext, source: string): void {
    const title = titleFromSource(source);
    if (MermaidPanel.current) {
      MermaidPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      MermaidPanel.current.update(source, title);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      MermaidPanel.viewType,
      title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          context.extensionUri,
          vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
        ],
      },
    );
    MermaidPanel.current = new MermaidPanel(panel, context, source, title);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    source: string,
    title: string,
  ) {
    this.pendingSource = source;
    panel.title = title;
    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "media", "icon-light.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "media", "icon-dark.svg"),
    };
    panel.webview.html = renderWebviewHtml(panel.webview, context.extensionUri, "mermaid");

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg.type === "ready") this.post();
      }),
    );
    panel.onDidDispose(() => this.dispose());
  }

  private update(source: string, title: string): void {
    this.pendingSource = source;
    this.panel.title = title;
    this.post();
  }

  private post(): void {
    void this.panel.webview.postMessage({ type: "mermaid_doc", source: this.pendingSource });
  }

  private dispose(): void {
    MermaidPanel.current = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
  }
}
