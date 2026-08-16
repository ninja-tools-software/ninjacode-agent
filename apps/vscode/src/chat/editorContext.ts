import * as vscode from "vscode";
import path from "node:path";
import type { ContextRef } from "../protocol.js";
import { createRef } from "./contextRefs.js";

const MAX_SELECTION_CHARS = 8_000;

/** Open/visible editor files, including the active selection's document. */
export function activeEditorFiles(workspaceRoot: string): string[] {
  const files = new Set<string>();
  const editors = [
    ...(vscode.window.activeTextEditor ? [vscode.window.activeTextEditor] : []),
    ...vscode.window.visibleTextEditors,
  ];
  for (const editor of editors) {
    if (editor.document.uri.scheme !== "file") continue;
    const relative = path.relative(workspaceRoot, editor.document.uri.fsPath);
    if (
      relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    ) {
      files.add(relative.replace(/\\/g, "/"));
    }
  }
  return [...files];
}

/** The active editor selection as an attachable reference, or null when there is none. */
export function currentSelectionRef(root: string | undefined): ContextRef | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return null;
  return selectionRefFrom(editor.document, editor.selection, root);
}

/** Build a `selection` reference from any document + range (also used by the native commands). */
export function selectionRefFrom(
  document: vscode.TextDocument,
  range: vscode.Range | vscode.Selection,
  root: string | undefined,
): ContextRef {
  const rel = root ? path.relative(root, document.uri.fsPath) : document.fileName;
  const start = range.start.line + 1;
  const end = range.end.line + 1;
  const label = start === end ? `${path.basename(rel)}:${start}` : `${path.basename(rel)}:${start}-${end}`;
  const body = document.getText(range).slice(0, MAX_SELECTION_CHARS);
  const ref = createRef({
    kind: "selection",
    target: rel,
    label,
    range: { start, end },
    detail: `Selection in ${rel} (lines ${start}-${end}):\n\`\`\`${document.languageId}\n${body}\n\`\`\``,
  });
  return ref;
}

/** Errors across the workspace, auto-appended to every prompt (bounded). */
export function workspaceErrorsSection(workspaceRoot: string): string {
  const lines: string[] = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).slice(0, 5);
    if (!errors.length) continue;
    const rel = path.relative(workspaceRoot, uri.fsPath);
    for (const d of errors) lines.push(`${rel}:${d.range.start.line + 1}: ${d.message}`);
    if (lines.length >= 20) break;
  }
  if (!lines.length) return "";
  return `Workspace diagnostics (errors):\n${lines.join("\n")}`;
}

/** The active selection as an auto-appended prompt section (independent of badges). */
export function activeSelectionSection(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return "";
  const sel = editor.document.getText(editor.selection);
  const rel = vscode.workspace.asRelativePath(editor.document.uri);
  return `Current selection in ${rel}:\n\`\`\`\n${sel.slice(0, 4_000)}\n\`\`\``;
}

/** Diagnostics callback handed to the Agent so tools can read live problems. */
export function createDiagnosticsProvider(workspaceRoot: string) {
  return async (paths?: string[]) => {
    const out: Array<{
      path: string;
      line: number;
      column: number;
      severity: "error" | "warning" | "info";
      message: string;
      source?: string;
    }> = [];
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      const rel = path.relative(workspaceRoot, uri.fsPath);
      if (rel.startsWith("..")) continue;
      if (paths?.length && !paths.some((p) => rel === p || rel.endsWith(p))) continue;
      for (const d of diags) {
        const severity =
          d.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : d.severity === vscode.DiagnosticSeverity.Warning
              ? "warning"
              : "info";
        out.push({
          path: rel,
          line: d.range.start.line + 1,
          column: d.range.start.character + 1,
          severity,
          message: d.message,
          source: d.source,
        });
      }
    }
    return out;
  };
}
