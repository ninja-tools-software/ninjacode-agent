import * as vscode from "vscode";
import path from "node:path";
import type { ContextSuggestion } from "../../protocol.js";
import { MAX_SUGGESTIONS, type ContextProvider } from "./types.js";

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return "error";
    case vscode.DiagnosticSeverity.Warning:
      return "warning";
    case vscode.DiagnosticSeverity.Information:
      return "info";
    default:
      return "hint";
  }
}

/** Workspace-relative files that currently have errors or warnings. */
function filesWithDiagnostics(root: string): Array<{ rel: string; errors: number; warnings: number }> {
  const out: Array<{ rel: string; errors: number; warnings: number }> = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const rel = path.relative(root, uri.fsPath);
    if (rel.startsWith("..")) continue;
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (!errors && !warnings) continue;
    out.push({ rel, errors, warnings });
  }
  return out;
}

/** Render one file's diagnostics as prompt text. */
function renderDiagnostics(root: string, rel: string): string {
  const uri = vscode.Uri.file(path.join(root, rel));
  const diags = vscode.languages.getDiagnostics(uri);
  const lines = diags.map(
    (d) =>
      `${d.range.start.line + 1}:${d.range.start.character + 1} [${severityLabel(d.severity)}] ${d.message}`,
  );
  return `Diagnostics for ${rel}:\n${lines.join("\n")}`;
}

export const diagnosticsProvider: ContextProvider = {
  kind: "diagnostics",
  async suggest(query, env) {
    const q = query.trim().toLowerCase();
    const items: ContextSuggestion[] = [];
    for (const { rel, errors, warnings } of filesWithDiagnostics(env.root)) {
      if (q && !rel.toLowerCase().includes(q)) continue;
      items.push({ id: rel, label: rel, detail: `${errors} error(s), ${warnings} warning(s)` });
    }
    return items.slice(0, MAX_SUGGESTIONS);
  },
  async resolve(target, env) {
    return { text: renderDiagnostics(env.root, target), label: `Problems in ${target}` };
  },
};
