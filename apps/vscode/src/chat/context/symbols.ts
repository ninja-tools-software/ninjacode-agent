import fs from "node:fs/promises";
import path from "node:path";
import type { ContextSuggestion } from "../../protocol.js";
import { MAX_SUGGESTIONS, type ContextProvider } from "./types.js";

/** Lines of surrounding context included when resolving a symbol. */
const LINES_BEFORE = 8;
const LINES_AFTER = 20;

/** Symbol targets are `path/to/file.ts:42` — the path itself may contain colons on
 * some platforms, so split from the right. */
function parseSymbolTarget(target: string): { filePath: string; line: number } {
  const idx = target.lastIndexOf(":");
  if (idx === -1) return { filePath: target, line: 1 };
  return { filePath: target.slice(0, idx), line: Number(target.slice(idx + 1)) || 1 };
}

export const symbolProvider: ContextProvider = {
  kind: "symbol",
  async suggest(query, env) {
    const q = query.trim().toLowerCase();
    const index = await env.index();
    if (!index) return [];
    const items: ContextSuggestion[] = [];
    for (const f of index.listFiles()) {
      for (const sym of f.symbols) {
        if (!q || sym.name.toLowerCase().includes(q)) {
          items.push({
            id: `${f.path}:${sym.line}`,
            label: sym.name,
            detail: `${sym.kind} — ${f.path}:${sym.line}`,
          });
        }
      }
      if (items.length >= 40) break;
    }
    return items.slice(0, MAX_SUGGESTIONS);
  },
  async resolve(target, env) {
    const { filePath, line } = parseSymbolTarget(target);
    const raw = await fs.readFile(path.join(env.root, filePath), "utf8");
    const lines = raw.split("\n");
    const start = Math.max(0, line - LINES_BEFORE);
    const end = Math.min(lines.length, line + LINES_AFTER);
    return {
      text: `Symbol in ${filePath}:${line}:\n\`\`\`\n${lines.slice(start, end).join("\n")}\n\`\`\``,
      label: `${path.basename(filePath)}:${line}`,
    };
  },
};
