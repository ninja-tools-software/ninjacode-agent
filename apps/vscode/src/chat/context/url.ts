import path from "node:path";
import { fetchUrlTool } from "@ninjacode/tools";
import type { ContextProvider } from "./types.js";

const MAX_URL_CHARS = 8_000;

export const urlProvider: ContextProvider = {
  kind: "url",
  async suggest(query) {
    const url = query.trim();
    if (!url) return [];
    return [{ id: url, label: url, detail: "Fetch this URL as context" }];
  },
  async resolve(target, env) {
    try {
      const result = await fetchUrlTool.execute(
        { workspaceRoot: env.root, agentDir: path.join(env.root, ".ninjacode") },
        { url: target, max_chars: MAX_URL_CHARS },
      );
      return { text: `URL ${target}:\n${result.output}`, label: target };
    } catch (e) {
      return { text: `[Failed to fetch ${target}: ${(e as Error).message}]`, label: target };
    }
  },
};
