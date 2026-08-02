import * as vscode from "vscode";
import path from "node:path";
import type { CodebaseIndex } from "@ninjacode/tools";
import type { ContextQueryType, ContextRef, DropItem } from "../protocol.js";
import type { ChatCore } from "./chatCore.js";
import { createRef, estimateTokens, flagUnsupportedImages, resolveRefs } from "./contextRefs.js";
import { resolveContext, suggestContext, type ContextEnv } from "./context/index.js";
import { currentSelectionRef } from "./editorContext.js";
import { resolveDropItems } from "./dropResolver.js";
import { readRunConfig } from "./runConfig.js";

const MAX_PREVIEW_CHARS = 2_000;

interface ContextControllerDeps {
  core: ChatCore;
  /** Build-on-demand codebase index for the workspace. */
  codebaseIndex(root: string): Promise<CodebaseIndex | undefined>;
  /** Workspace-relative paths of recently focused files, newest first. */
  recentFiles(): readonly string[];
}

/**
 * Everything that turns a user gesture into context references: the `+` picker,
 * `@` mentions, drag & drop, and the badge lifecycle (resolve, preview, open).
 */
export class ContextController {
  constructor(private readonly deps: ContextControllerDeps) {}

  private get core(): ChatCore {
    return this.deps.core;
  }

  /** Environment handed to context providers. Undefined workspace ⇒ no context sources. */
  env(root?: string): ContextEnv | undefined {
    const workspaceRoot = root ?? this.core.workspaceRoot();
    if (!workspaceRoot) return undefined;
    return {
      root: workspaceRoot,
      index: () => this.deps.codebaseIndex(workspaceRoot).catch(() => undefined),
      recentFiles: this.deps.recentFiles(),
    };
  }

  /** Legacy `@` autocomplete: plain file paths, no badge. */
  async suggestMentions(query: string): Promise<void> {
    const root = this.core.workspaceRoot();
    if (!root) return;
    const pattern = query ? `**/*${query}*` : "**/*.{ts,tsx,js,jsx,py,rs,go,md}";
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", 20);
    this.core.post(undefined, {
      type: "mention_suggestions",
      items: files.map((f) => path.relative(root, f.fsPath)),
    });
  }

  async suggest(queryType: ContextQueryType, query: string): Promise<void> {
    const env = this.env();
    const items = env ? await suggestContext(queryType, query, env) : [];
    this.core.post(undefined, { type: "context_suggestions", queryType, items });
  }

  /** Turn one picked suggestion into a resolved badge. */
  async resolveItem(
    queryType: ContextQueryType,
    contextId: string,
    label: string,
    requestId: string,
  ): Promise<void> {
    const env = this.env();
    if (!env) {
      this.core.post(undefined, { type: "context_resolved", requestId, ref: null });
      return;
    }
    const resolved = await resolveContext(queryType, contextId, env);
    const ref = createRef({
      kind: queryType,
      target: contextId,
      label: resolved.label ?? label,
      detail: contextId,
    });
    this.core.post(undefined, {
      type: "context_resolved",
      requestId,
      ref: { ...ref, tokens: estimateTokens(resolved.text) },
    });
  }

  /** The `+` picker's "Selection" shortcut. */
  postCurrentSelection(requestId: string): void {
    const ref = currentSelectionRef(this.core.workspaceRoot());
    this.core.post(undefined, { type: "context_resolved", requestId, ref });
  }

  /** Drag & drop: resolve dropped URIs/files/text into badges. */
  async resolveDrop(requestId: string, items: DropItem[]): Promise<void> {
    const refs = await resolveDropItems(items, this.core.workspaceRoot());
    this.core.post(undefined, { type: "refs_resolved", requestId, refs: this.flagImages(refs) });
  }

  /** Re-resolve badges (restored drafts, retry after an error) and report token counts. */
  async resolveExisting(requestId: string, refs: ContextRef[]): Promise<void> {
    const env = this.env();
    if (!env) {
      this.core.post(undefined, { type: "refs_resolved", requestId, refs });
      return;
    }
    const resolved = await resolveRefs(refs, env);
    this.core.post(undefined, { type: "refs_resolved", requestId, refs: this.flagImages(resolved.refs) });
  }

  /** A text-only model turns every attached image into a dead badge; say it upfront. */
  private flagImages(refs: readonly ContextRef[]): ContextRef[] {
    return flagUnsupportedImages(refs, readRunConfig().vision);
  }

  /** Hover preview for a badge. */
  async preview(requestId: string, ref: ContextRef): Promise<void> {
    const env = this.env();
    if (!env) {
      this.core.post(undefined, { type: "ref_preview_result", requestId, preview: "" });
      return;
    }
    const { blocks, refs } = await resolveRefs([ref], env);
    const text = blocks[0] ?? "";
    this.core.post(undefined, {
      type: "ref_preview_result",
      requestId,
      preview: text.slice(0, MAX_PREVIEW_CHARS),
      tokens: refs[0]?.tokens,
    });
  }

  /** Click on a badge: open the underlying resource, at the referenced line when known. */
  async open(ref: ContextRef): Promise<void> {
    const root = this.core.workspaceRoot();
    if (ref.kind === "url") {
      await vscode.env.openExternal(vscode.Uri.parse(ref.target));
      return;
    }
    if (!root || ref.kind === "image" || ref.kind === "snippet" || ref.kind === "terminal") return;

    const absolute = path.isAbsolute(ref.target) ? ref.target : path.join(root, targetPath(ref));
    const uri = vscode.Uri.file(absolute);
    if (ref.kind === "folder") {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
    const line = ref.range?.start ?? lineFromTarget(ref.target);
    const editor = await vscode.window.showTextDocument(uri, { preview: true });
    if (line) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(pos, pos);
    }
  }

  /** Native file picker fallback, for when drag & drop isn't practical. */
  async pickFiles(requestId: string): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: true,
      openLabel: "Attach to chat",
    });
    const items: DropItem[] = (picked ?? []).map((uri) => ({ kind: "uri", value: uri.toString() }));
    await this.resolveDrop(requestId, items);
  }
}

/** Symbol targets carry a `:line` suffix that is not part of the path. */
function targetPath(ref: ContextRef): string {
  if (ref.kind !== "symbol") return ref.target;
  const idx = ref.target.lastIndexOf(":");
  return idx === -1 ? ref.target : ref.target.slice(0, idx);
}

function lineFromTarget(target: string): number | undefined {
  const idx = target.lastIndexOf(":");
  if (idx === -1) return undefined;
  const n = Number(target.slice(idx + 1));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
