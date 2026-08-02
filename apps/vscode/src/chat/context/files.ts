import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import type { ContextSuggestion } from "../../protocol.js";
import { MAX_SUGGESTIONS, type ContextEnv, type ContextProvider, type ResolvedContext } from "./types.js";

const MAX_FILE_CHARS = 12_000;

/** Read one workspace file as a fenced prompt block. Shared by every file-shaped source. */
async function resolveFile(target: string, env: ContextEnv): Promise<ResolvedContext> {
  const raw = await fs.readFile(path.join(env.root, target), "utf8");
  const truncated = raw.length > MAX_FILE_CHARS;
  const body = raw.slice(0, MAX_FILE_CHARS);
  const note = truncated ? `\n[truncated: showing ${MAX_FILE_CHARS} of ${raw.length} characters]` : "";
  return { text: `File ${target}:\n\`\`\`\n${body}\n\`\`\`${note}`, label: target };
}

export const fileProvider: ContextProvider = {
  kind: "file",
  async suggest(query, env) {
    const pattern = query ? `**/*${query}*` : "**/*.{ts,tsx,js,jsx,py,rs,go,md,json}";
    const files = await vscode.workspace.findFiles(pattern, "**/node_modules/**", MAX_SUGGESTIONS);
    return files.map((f) => {
      const rel = path.relative(env.root, f.fsPath);
      return { id: rel, label: rel };
    });
  },
  resolve: resolveFile,
};

export const openTabProvider: ContextProvider = {
  kind: "open_tab",
  async suggest(query, env) {
    const q = query.trim().toLowerCase();
    const items: ContextSuggestion[] = [];
    const seen = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!(tab.input instanceof vscode.TabInputText)) continue;
        const rel = path.relative(env.root, tab.input.uri.fsPath);
        if (rel.startsWith("..") || seen.has(rel)) continue;
        seen.add(rel);
        if (!q || rel.toLowerCase().includes(q)) items.push({ id: rel, label: rel });
      }
    }
    return items;
  },
  resolve: resolveFile,
};

export const recentProvider: ContextProvider = {
  kind: "recent",
  async suggest(query, env) {
    const q = query.trim().toLowerCase();
    return env.recentFiles
      .filter((f) => !q || f.toLowerCase().includes(q))
      .map((f) => ({ id: f, label: f }));
  },
  resolve: resolveFile,
};

export const codebaseProvider: ContextProvider = {
  kind: "codebase",
  async suggest(query, env) {
    if (!query.trim()) return [];
    const index = await env.index();
    const hits = index ? await index.search(query, { limit: 20 }) : [];
    return hits.map((h) => ({
      id: h.path,
      label: h.path,
      detail: h.symbols?.length ? `symbols: ${h.symbols.join(", ")}` : undefined,
    }));
  },
  resolve: resolveFile,
};
