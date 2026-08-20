import type { Tool, ToolResult } from "./types.js";
import { ToolError } from "./types.js";

const MAX_RESULTS = 8;
const TIMEOUT_MS = 15_000;
export const NINJACODE_USER_AGENT = "NinjaCode (+https://ninjacode.dev)";

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web for up-to-date information. Returns titles, URLs, and snippets. " +
    "Use for documentation, API changes, or facts not in the codebase.",
  risk: "network",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      max_results: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
  target(args) {
    return String(args.query ?? "").slice(0, 120);
  },
  async execute(ctx, args): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) throw new ToolError("query is required", "invalid_args");
    const limit =
      typeof args.max_results === "number" && args.max_results > 0
        ? Math.min(Math.floor(args.max_results), MAX_RESULTS)
        : 5;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const signal = ctx.signal
      ? AbortSignal.any([ctx.signal, controller.signal])
      : controller.signal;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        signal,
        headers: {
          "User-Agent": `${NINJACODE_USER_AGENT} web_search`,
          Accept: "text/html",
        },
      });
      if (!res.ok) {
        throw new ToolError(`Search failed: HTTP ${res.status}`, "runtime");
      }
      const html = await res.text();
      const results = parseDuckDuckGoResults(html, limit);
      if (results.length === 0) {
        return { output: "(no results)", meta: { count: 0, query } };
      }
      const lines = results.map(
        (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`,
      );
      return {
        output: lines.join("\n\n"),
        meta: { count: results.length, query, results },
      };
    } catch (e) {
      if (signal.aborted && ctx.signal?.aborted) {
        throw new ToolError("Search aborted", "aborted");
      }
      throw new ToolError(`Search error: ${(e as Error).message}`, "runtime");
    } finally {
      clearTimeout(timeout);
    }
  },
};

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Pure HTML scrape of DuckDuckGo's lite results page — fragile by design. */
export function parseDuckDuckGoResults(html: string, limit: number): SearchHit[] {
  const hits: SearchHit[] = [];
  const resultRe =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a|<td[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/td>)/gi;
  let m: RegExpExecArray | null;
  while ((m = resultRe.exec(html)) && hits.length < limit) {
    let url = decodeURIComponent(m[1]!.replace(/.*uddg=/, "").replace(/&amp;.*/, ""));
    if (url.startsWith("//")) url = `https:${url}`;
    const title = stripTags(m[2]!);
    const snippet = stripTags(m[3] ?? m[4] ?? "");
    if (title && url) hits.push({ title, url, snippet });
  }
  return hits;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
