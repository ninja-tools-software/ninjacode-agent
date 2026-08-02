/**
 * Native "Add to NinjaCode chat" entry points: explorer, editor tab, editor
 * selection, source control and terminal. They all funnel into the same drop
 * resolver the webview uses, so a menu action and a drag produce the same badge.
 */
import * as vscode from "vscode";
import path from "node:path";
import type { ContextRef, DropItem } from "../protocol.js";
import { WORKING_TREE_TARGET } from "./context/index.js";
import { createRef } from "./contextRefs.js";
import { resolveDropItems } from "./dropResolver.js";
import { selectionRefFrom } from "./editorContext.js";

/** What the commands need from the chat view. */
interface AddToChatHost {
  addContextToChat(refs: ContextRef[]): Promise<void>;
}

/** Anything VS Code hands to a context-menu command that may carry a URI. */
type UriLike = { scheme?: unknown; fsPath?: unknown; path?: unknown; toString(): string };

function isUri(value: unknown): value is vscode.Uri {
  if (!value || typeof value !== "object") return false;
  const candidate = value as UriLike;
  return typeof candidate.scheme === "string" && typeof candidate.path === "string";
}

/**
 * Menu commands are called with wildly different shapes: a single URI, a URI plus
 * the full multi-selection, or SCM resource states. Flatten them all to URIs,
 * keeping the menu order and dropping duplicates.
 */
export function collectUris(args: readonly unknown[]): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  const seen = new Set<string>();

  const push = (value: unknown): void => {
    if (isUri(value)) {
      const key = value.toString();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) push(entry);
      return;
    }
    if (value && typeof value === "object" && "resourceUri" in value) {
      push((value as { resourceUri: unknown }).resourceUri);
    }
  };

  for (const arg of args) push(arg);
  return out;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Reuse the drop pipeline: a URI from a menu is the same thing as a dragged URI. */
async function refsForUris(uris: readonly vscode.Uri[]): Promise<ContextRef[]> {
  const items: DropItem[] = uris.map((uri) => ({ kind: "uri", value: uri.toString() }));
  return resolveDropItems(items, workspaceRoot());
}

/** The uncommitted diff of a file, or of the whole working tree. */
function diffRef(uri?: vscode.Uri): ContextRef {
  const root = workspaceRoot();
  if (!uri) {
    return createRef({
      kind: "scm_diff",
      target: WORKING_TREE_TARGET,
      label: "Uncommitted changes",
      detail: "git diff (working tree)",
    });
  }
  const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, "/") : uri.fsPath;
  return createRef({ kind: "scm_diff", target: rel, label: `diff ${path.basename(rel)}`, detail: rel });
}

/** Problems of a file, as a `diagnostics` badge (resolved lazily at send time). */
function diagnosticsRef(uri: vscode.Uri): ContextRef | undefined {
  const root = workspaceRoot();
  const rel = root ? path.relative(root, uri.fsPath).replace(/\\/g, "/") : uri.fsPath;
  if (rel.startsWith("..")) return undefined;
  const count = vscode.languages.getDiagnostics(uri).length;
  if (count === 0) return undefined;
  return createRef({
    kind: "diagnostics",
    target: rel,
    label: `${path.basename(rel)} problems`,
    detail: `${count} problem(s) in ${rel}`,
  });
}

/**
 * The terminal buffer is not readable through the API, so we copy the selection
 * through the clipboard and restore it — the standard workaround.
 */
async function terminalSelectionRef(): Promise<ContextRef | undefined> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) return undefined;
  const previous = await vscode.env.clipboard.readText();
  try {
    await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
    const text = (await vscode.env.clipboard.readText()).trim();
    if (!text || text === previous.trim()) return undefined;
    return createRef({
      kind: "terminal",
      target: `terminal:${terminal.name}:${text.length}`,
      label: terminal.name,
      detail: `Terminal ${terminal.name}:\n\`\`\`\n${text.slice(0, 8_000)}\n\`\`\``,
    });
  } finally {
    await vscode.env.clipboard.writeText(previous);
  }
}

export function registerAddToChatCommands(
  context: vscode.ExtensionContext,
  host: AddToChatHost,
): void {
  const attach = async (refs: readonly (ContextRef | undefined)[], emptyMessage: string): Promise<void> => {
    const usable = refs.filter((r): r is ContextRef => r !== undefined);
    if (usable.length === 0) {
      vscode.window.showInformationMessage(emptyMessage);
      return;
    }
    await host.addContextToChat(usable);
  };

  context.subscriptions.push(
    // Explorer, editor tabs and source control all pass URIs (or resource states).
    vscode.commands.registerCommand("ninjacode.addToChat", async (...args: unknown[]) => {
      const uris = collectUris(args);
      if (uris.length === 0) {
        const active = vscode.window.activeTextEditor;
        if (active) uris.push(active.document.uri);
      }
      await attach(await refsForUris(uris), "NinjaCode: nothing to attach.");
    }),

    vscode.commands.registerCommand("ninjacode.addSelectionToChat", async () => {
      const editor = vscode.window.activeTextEditor;
      const ref =
        editor && !editor.selection.isEmpty
          ? selectionRefFrom(editor.document, editor.selection, workspaceRoot())
          : undefined;
      if (ref) {
        await attach([ref], "");
        return;
      }
      // No selection: attach the whole file rather than doing nothing.
      const uris = editor ? [editor.document.uri] : [];
      await attach(await refsForUris(uris), "NinjaCode: open a file or select some code first.");
    }),

    vscode.commands.registerCommand("ninjacode.addProblemsToChat", async (...args: unknown[]) => {
      const uris = collectUris(args);
      if (uris.length === 0) {
        const active = vscode.window.activeTextEditor;
        if (active) uris.push(active.document.uri);
      }
      await attach(uris.map(diagnosticsRef), "NinjaCode: no problems reported for this file.");
    }),

    // Source Control: attach the diff itself, not just the file's content.
    vscode.commands.registerCommand("ninjacode.addDiffToChat", async (...args: unknown[]) => {
      const uris = collectUris(args);
      await attach(uris.length > 0 ? uris.map((u) => diffRef(u)) : [diffRef()], "");
    }),

    vscode.commands.registerCommand("ninjacode.addTerminalSelectionToChat", async () => {
      await attach([await terminalSelectionRef()], "NinjaCode: select some terminal output first.");
    }),
  );
}
