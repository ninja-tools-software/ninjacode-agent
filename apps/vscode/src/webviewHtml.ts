import * as vscode from "vscode";
import { resolveEffectiveLocale } from "./locale.js";

/**
 * Shell HTML for both webview surfaces. `view` is read back by the bundle
 * (`document.body.dataset.view`) to mount either the chat or the settings app,
 * so a single Vite bundle serves the sidebar view and the settings editor tab.
 */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  view: "chat" | "settings" | "plan" | "mermaid",
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "assets", "index.js"),
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "assets", "index.css"),
  );
  const locale = resolveEffectiveLocale();
  const nonce = String(Date.now());
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}">
  <title>NinjaCode</title>
</head>
<body data-view="${view}" data-locale="${locale}">
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
