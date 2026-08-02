import * as vscode from "vscode";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_SUGGESTIONS, type ContextProvider } from "./types.js";

export const folderProvider: ContextProvider = {
  kind: "folder",
  async suggest(query, env) {
    const q = query.trim().toLowerCase();
    const files = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 2000);
    const dirs = new Set<string>();
    for (const f of files) {
      let dir = path.dirname(path.relative(env.root, f.fsPath));
      while (dir && dir !== ".") {
        dirs.add(dir);
        dir = path.dirname(dir);
      }
    }
    return [...dirs]
      .filter((d) => !q || d.toLowerCase().includes(q))
      .sort()
      .slice(0, MAX_SUGGESTIONS)
      .map((d) => ({ id: d, label: `${d}/` }));
  },
  async resolve(target, env) {
    const entries = await fs.readdir(path.join(env.root, target), { withFileTypes: true });
    const listing = entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
    return { text: `Folder ${target}/:\n${listing || "(empty)"}`, label: `${target}/` };
  },
};
