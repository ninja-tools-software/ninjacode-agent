import fs from "node:fs/promises";
import path from "node:path";
import type { CodebaseSearchHit, Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { ripgrepIgnoreArgs, SKIPPED_DIR_GLOBS } from "./ignore.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";
import { spawnCapture } from "./process.js";
import { collectFiles } from "./walk.js";

const GLOB_MAX = 200;
const GLOB_CAP_NOTE = `[showing first ${GLOB_MAX} matches — narrow the pattern to see more]`;

function cappedGlobOutput(matches: string[]): string {
  const capped = matches.length > GLOB_MAX;
  const shown = matches.slice(0, GLOB_MAX);
  const body = shown.join("\n") || "(no matches)";
  return capped ? `${body}\n${GLOB_CAP_NOTE}` : body;
}

async function findRgBinary(): Promise<string | null> {
  try {
    // @vscode/ripgrep ships a platform binary
    const mod = await import("@vscode/ripgrep");
    const rgPath = (mod as { rgPath?: string }).rgPath;
    if (rgPath) return rgPath;
  } catch {
    // optional dependency
  }
  return "rg"; // system ripgrep fallback
}

function cappedGrepOutput(lines: string[], max: number): string {
  const capped = lines.length >= max;
  const body = lines.join("\n") || "(no matches)";
  const note = `[showing first ${max} matches — raise max_results or narrow the pattern]`;
  return capped ? `${body}\n${note}` : body;
}

export const globTool: Tool = {
  name: "glob",
  description: "Find files matching a glob pattern (e.g. **/*.ts). Respects .gitignore when possible.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Subdirectory to search (default: .)" },
    },
    required: ["pattern"],
  },
  target(args) {
    return String(args.pattern ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    const sub = toWorkspaceRelative(ctx.workspaceRoot, String(args.path ?? "."));
    const abs = resolveInWorkspace(ctx.workspaceRoot, sub);

    try {
      const fg = await import("fast-glob");
      const matches = await fg.default(pattern, {
        cwd: abs,
        onlyFiles: true,
        dot: false,
        ignore: [...SKIPPED_DIR_GLOBS],
        absolute: false,
        followSymbolicLinks: false,
      });
      const relative = matches.map((m) => (sub === "." ? m : path.join(sub, m)).replace(/\\/g, "/"));
      return {
        output: cappedGlobOutput(relative),
        meta: { count: Math.min(relative.length, GLOB_MAX), engine: "fast-glob" },
      };
    } catch {
      // fallback walk
      const files = await relativeFiles(abs, ctx.workspaceRoot);
      const filtered = files.filter((f) => matchGlob(f, pattern));
      return {
        output: cappedGlobOutput(filtered),
        meta: { count: Math.min(filtered.length, GLOB_MAX), engine: "fallback" },
      };
    }
  },
};

export const grepTool: Tool = {
  name: "grep",
  description: "Search file contents with a regular expression (ripgrep when available).",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern" },
      path: { type: "string", description: "File or directory (default: .)" },
      glob: { type: "string", description: "Optional file glob filter" },
      case_insensitive: { type: "boolean" },
      max_results: { type: "number" },
    },
    required: ["pattern"],
  },
  target(args) {
    return String(args.pattern ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    const sub = toWorkspaceRelative(ctx.workspaceRoot, String(args.path ?? "."));
    const fileGlob = args.glob ? String(args.glob) : undefined;
    const max = typeof args.max_results === "number" ? args.max_results : 50;
    const abs = resolveInWorkspace(ctx.workspaceRoot, sub);

    const rg = await findRgBinary();
    if (rg) {
      const rgArgs = [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--max-count",
        String(max),
        ...(args.case_insensitive ? ["-i"] : []),
        ...(fileGlob ? ["--glob", fileGlob] : []),
        ...ripgrepIgnoreArgs(),
        "-e",
        pattern,
        abs,
      ];
      try {
        const result = await spawnCapture(rg, rgArgs, {
          cwd: ctx.workspaceRoot,
          signal: ctx.signal,
        });
        // rg exit 1 = no matches
        if (result.code > 1) {
          throw new Error(result.stderr || `rg exit ${result.code}`);
        }
        const lines = result.stdout
          .split("\n")
          .filter(Boolean)
          .slice(0, max)
          .map((line) => {
            // Make paths relative to workspace
            if (line.startsWith(ctx.workspaceRoot)) {
              return path.relative(ctx.workspaceRoot, line.split(":")[0]!) +
                ":" +
                line.slice(line.indexOf(":") + 1);
            }
            return line.replace(ctx.workspaceRoot + path.sep, "");
          });
        return {
          output: cappedGrepOutput(lines, max),
          meta: { count: lines.length, engine: "ripgrep" },
        };
      } catch {
        // fall through to JS
      }
    }

    return jsGrep({
      ctx,
      abs,
      pattern,
      fileGlob,
      caseInsensitive: Boolean(args.case_insensitive),
      max,
    });
  },
};

interface JsGrepOptions {
  ctx: ToolContext;
  abs: string;
  pattern: string;
  fileGlob?: string;
  caseInsensitive: boolean;
  max: number;
}

async function jsGrep(opts: JsGrepOptions): Promise<ToolResult> {
  const { ctx, abs, pattern, fileGlob, caseInsensitive, max } = opts;
  let re: RegExp;
  try {
    re = new RegExp(pattern, caseInsensitive ? "i" : undefined);
  } catch (e) {
    throw new ToolError(`Invalid regex: ${(e as Error).message}`, "invalid_args");
  }

  const st = await fs.stat(abs).catch(() => null);
  if (!st) throw new ToolError(`Path not found`, "not_found");
  const files = st.isFile()
    ? [path.relative(ctx.workspaceRoot, abs)]
    : await relativeFiles(abs, ctx.workspaceRoot);

  const filtered = fileGlob ? files.filter((f) => matchGlob(f, fileGlob)) : files;
  const hits: string[] = [];
  for (const rel of filtered) {
    if (hits.length >= max) break;
    const fileAbs = path.join(ctx.workspaceRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(fileAbs, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= max) break;
      if (re.test(lines[i]!)) hits.push(`${rel}:${i + 1}:${lines[i]}`);
    }
  }
  return {
    output: cappedGrepOutput(hits, max),
    meta: { count: hits.length, engine: "js-fallback" },
  };
}

/** Workspace-relative file paths under `dir`, for the no-ripgrep fallback paths. */
async function relativeFiles(dir: string, root: string): Promise<string[]> {
  const absolute = await collectFiles(dir);
  return absolute.map((abs) => path.relative(root, abs));
}

export const searchCodebaseTool: Tool = {
  name: "search_codebase",
  description:
    "Semantic-ish ranked search over the whole workspace by meaning/keywords (not just literal text). " +
    "Prefer this over grep when you don't know the exact string — it ranks files by relevance, including symbol name matches. " +
    "Uses a local lexical index when available, falling back to a ripgrep/glob-based heuristic otherwise.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language or keyword query" },
      limit: { type: "number", description: "Max results (default 10)" },
    },
    required: ["query"],
  },
  target(args) {
    return String(args.query ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const query = String(args.query ?? "").trim();
    if (!query) throw new ToolError("query is required", "invalid_args");
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 10;

    let hits: CodebaseSearchHit[];
    let engine: string;
    if (ctx.codebaseIndex) {
      const index = ctx.codebaseIndex;
      if (index.hasSemanticLayer && index.semanticSearch) {
        hits = await index.semanticSearch(query, { limit });
        engine = "semantic";
        if (hits.length === 0) {
          hits = await index.search(query, { limit });
          engine = "index";
        }
      } else {
        hits = await index.search(query, { limit });
        engine = "index";
      }
    } else {
      hits = await fallbackCodebaseSearch(ctx, query, limit);
      engine = "fallback";
    }

    if (hits.length === 0) {
      return { output: "(no matches)", meta: { count: 0, engine } };
    }

    const lines = hits.map((h, i) => {
      const symbolNote = h.symbols?.length ? ` [symbols: ${h.symbols.join(", ")}]` : "";
      const snippetNote = h.snippet ? `\n    ${h.snippet.split("\n").join("\n    ")}` : "";
      return `${i + 1}. ${h.path} (score ${h.score.toFixed(2)})${symbolNote}${snippetNote}`;
    });

    return {
      output: lines.join("\n"),
      meta: { count: hits.length, engine, paths: hits.map((h) => h.path) },
    };
  },
};

/**
 * Fallback ranking used when no `CodebaseIndex` is wired into `ToolContext`:
 * runs ripgrep (or the JS grep fallback) for each significant query term and
 * aggregates a simple hit-count score per file, boosting filename matches.
 */
type FallbackScoreEntry = { score: number; lines: string[] };

function recordRipgrepHit(
  scores: Map<string, FallbackScoreEntry>,
  line: string,
  root: string,
): void {
  const idx = line.indexOf(":");
  if (idx === -1) return;
  const abs = line.slice(0, idx);
  const rest = line.slice(idx + 1);
  const rel = abs.startsWith(root) ? path.relative(root, abs) : abs;
  const entry = scores.get(rel) ?? { score: 0, lines: [] };
  entry.score += 1;
  if (entry.lines.length < 3) entry.lines.push(rest.slice(0, 160));
  scores.set(rel, entry);
}

async function collectRipgrepScores(opts: {
  rg: string;
  root: string;
  terms: string[];
  signal: AbortSignal | undefined;
  scores: Map<string, FallbackScoreEntry>;
}): Promise<void> {
  const { rg, root, terms, signal, scores } = opts;
  const rgArgs = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "-i",
    "--max-count",
    "5",
    ...terms.flatMap((t) => ["-e", t]),
    ...ripgrepIgnoreArgs(),
    root,
  ];
  try {
    const result = await spawnCapture(rg, rgArgs, { cwd: root, signal });
    if (result.code > 1) return;
    for (const line of result.stdout.split("\n")) {
      if (line) recordRipgrepHit(scores, line, root);
    }
  } catch {
    // fall through to glob-only ranking below
  }
}

async function rankByFilename(
  root: string,
  terms: string[],
  scores: Map<string, FallbackScoreEntry>,
): Promise<void> {
  const files = await relativeFiles(root, root);
  for (const f of files) {
    const lower = f.toLowerCase();
    const hitCount = terms.filter((t) => lower.includes(t)).length;
    if (hitCount > 0) scores.set(f, { score: hitCount, lines: [] });
  }
}

function boostQueryPathMatches(
  scores: Map<string, FallbackScoreEntry>,
  query: string,
): void {
  const queryLower = query.toLowerCase();
  for (const [rel, entry] of scores) {
    if (rel.toLowerCase().includes(queryLower)) entry.score += 2;
  }
}

function toCodebaseHits(
  scores: Map<string, FallbackScoreEntry>,
  limit: number,
): CodebaseSearchHit[] {
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([p, v]) => ({ path: p, score: v.score, snippet: v.lines.join("\n") || undefined }));
}

async function fallbackCodebaseSearch(
  ctx: ToolContext,
  query: string,
  limit: number,
): Promise<CodebaseSearchHit[]> {
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9_]+/i).filter((t) => t.length >= 2))];
  if (terms.length === 0) return [];

  const scores = new Map<string, FallbackScoreEntry>();
  const root = path.resolve(ctx.workspaceRoot);
  const rg = await findRgBinary();
  if (rg) {
    await collectRipgrepScores({ rg, root, terms, signal: ctx.signal, scores });
  }
  if (scores.size === 0) await rankByFilename(root, terms, scores);
  boostQueryPathMatches(scores, query);
  return toCodebaseHits(scores, limit);
}

function matchGlob(relPath: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
  const re = new RegExp(`^${escaped}$`);
  return re.test(relPath) || re.test(relPath.replace(/\\/g, "/"));
}
