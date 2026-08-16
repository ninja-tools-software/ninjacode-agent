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

const DEFAULT_GREP_CONTEXT = 2;

function formatGrepOutput(opts: {
  lines: string[];
  matchCount: number;
  max: number;
  emptyHint?: string;
}): string {
  if (opts.matchCount === 0) return opts.emptyHint ?? "(no matches)";
  const body = opts.lines.join("\n");
  if (opts.matchCount >= opts.max) {
    return `${body}\n[showing first ${opts.max} matches — raise max_results or narrow the pattern]`;
  }
  return body;
}

function grepEmptyHint(opts: { glob?: string; path: string }): string {
  const details: string[] = [];
  if (opts.glob) {
    details.push(
      `glob ${JSON.stringify(opts.glob)} — try without glob, or a gitignore-style pattern such as *.ts (matches any directory). Brace patterns like *.{ts,tsx} are expanded automatically.`,
    );
  }
  if (opts.path && opts.path !== ".") {
    details.push(`path ${JSON.stringify(opts.path)}`);
  }
  if (details.length === 0) return "(no matches)";
  return `(no matches)\n[${details.join("; ")}]`;
}

/** Expand `{a,b}` gitignore-style alternatives, including nested groups. */
export function expandBraceGlobs(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match || match.index === undefined) return [pattern];
  const alts = match[1]!.split(",");
  const out: string[] = [];
  for (const alt of alts) {
    const next = pattern.slice(0, match.index) + alt + pattern.slice(match.index + match[0].length);
    out.push(...expandBraceGlobs(next));
  }
  return [...new Set(out)];
}

function rgGlobArgs(fileGlob?: string): string[] {
  if (!fileGlob) return [];
  return expandBraceGlobs(fileGlob).flatMap((g) => ["--glob", g]);
}

function grepContextArgs(args: Record<string, unknown>): string[] {
  const context =
    typeof args.context_lines === "number"
      ? args.context_lines
      : typeof args.after !== "number" && typeof args.before !== "number"
        ? DEFAULT_GREP_CONTEXT
        : undefined;
  const out: string[] = [];
  if (typeof context === "number" && context > 0) out.push("-C", String(Math.floor(context)));
  if (typeof args.after === "number" && args.after > 0) out.push("-A", String(Math.floor(args.after)));
  if (typeof args.before === "number" && args.before > 0) out.push("-B", String(Math.floor(args.before)));
  return out;
}

function resolveGrepContext(args: Record<string, unknown>): { before: number; after: number } {
  const fallback =
    typeof args.after !== "number" && typeof args.before !== "number" ? DEFAULT_GREP_CONTEXT : 0;
  const context = typeof args.context_lines === "number" ? Math.max(0, Math.floor(args.context_lines)) : fallback;
  const after = typeof args.after === "number" ? Math.max(0, Math.floor(args.after)) : context;
  const before = typeof args.before === "number" ? Math.max(0, Math.floor(args.before)) : context;
  return { before, after };
}

/** Match lines from `rg -n` use `path:line:` ; context uses `path-line-`. */
function isGrepMatchLine(line: string): boolean {
  return /[^:\n]:\d+:/.test(line);
}

function takeGrepMatches(
  rawLines: string[],
  max: number,
): { lines: string[]; matchCount: number } {
  const lines: string[] = [];
  let matchCount = 0;
  let pendingSep = false;
  for (const line of rawLines) {
    if (line === "--") {
      pendingSep = true;
      continue;
    }
    if (!line) continue;
    const isMatch = isGrepMatchLine(line);
    if (isMatch) {
      if (matchCount >= max) break;
      if (pendingSep && lines.length > 0) lines.push("--");
      pendingSep = false;
      matchCount += 1;
      lines.push(line);
      continue;
    }
    if (matchCount >= max) continue;
    if (pendingSep && lines.length > 0) {
      lines.push("--");
      pendingSep = false;
    }
    lines.push(line);
  }
  return { lines, matchCount };
}

function relativizeGrepLine(line: string, workspaceRoot: string): string {
  if (line === "--") return line;
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  if (line.startsWith(root)) {
    let rest = line.slice(root.length);
    if (rest.startsWith("/") || rest.startsWith("\\")) rest = rest.slice(1);
    return rest.replace(/\\/g, "/");
  }
  return line.replace(/\\/g, "/");
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
  description:
    "Search file contents with a regular expression (ripgrep when available). " +
    "Returns surrounding lines (default 2) so you often do not need a follow-up read_file. " +
    "glob is gitignore-style: *.ts matches at any depth; brace patterns like *.{ts,tsx} are expanded. " +
    "Prefer this over run_shell with rg.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern" },
      path: { type: "string", description: "File or directory (default: .)" },
      glob: {
        type: "string",
        description:
          "Optional gitignore-style file filter (e.g. *.ts or **/*.tsx). Brace sets like *.{ts,tsx} are expanded. *.ts matches nested files.",
      },
      case_insensitive: { type: "boolean" },
      max_results: { type: "number", description: "Max matching lines across the whole search (default 50)" },
      context_lines: {
        type: "number",
        description: "Lines of context before and after each match (default 2). Equivalent to rg -C.",
      },
      after: { type: "number", description: "Lines after each match (rg -A). Overrides the after side of context_lines." },
      before: { type: "number", description: "Lines before each match (rg -B). Overrides the before side of context_lines." },
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
    const max = typeof args.max_results === "number" && args.max_results > 0 ? Math.floor(args.max_results) : 50;
    const abs = resolveInWorkspace(ctx.workspaceRoot, sub);
    const emptyHint = grepEmptyHint({ glob: fileGlob, path: sub });

    const rg = await findRgBinary();
    if (rg) {
      const rgArgs = [
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        ...grepContextArgs(args),
        ...(args.case_insensitive ? ["-i"] : []),
        ...rgGlobArgs(fileGlob),
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
        const relativized = result.stdout.split("\n").map((line) => relativizeGrepLine(line, ctx.workspaceRoot));
        const taken = takeGrepMatches(relativized, max);
        return {
          output: formatGrepOutput({
            lines: taken.lines,
            matchCount: taken.matchCount,
            max,
            emptyHint,
          }),
          meta: { count: taken.matchCount, engine: "ripgrep" },
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
      emptyHint,
      ...resolveGrepContext(args),
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
  before: number;
  after: number;
  emptyHint: string;
}

function formatJsGrepHit(
  rel: string,
  matchLine: number,
  fileLines: string[],
  before: number,
  after: number,
): string[] {
  const start = Math.max(1, matchLine - before);
  const end = Math.min(fileLines.length, matchLine + after);
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const sep = n === matchLine ? ":" : "-";
    out.push(`${rel}${sep}${n}${sep}${fileLines[n - 1] ?? ""}`);
  }
  return out;
}

async function jsGrep(opts: JsGrepOptions): Promise<ToolResult> {
  const { ctx, abs, pattern, fileGlob, caseInsensitive, max, before, after, emptyHint } = opts;
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
  let matchCount = 0;
  for (const rel of filtered) {
    if (matchCount >= max) break;
    const fileAbs = path.join(ctx.workspaceRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(fileAbs, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) continue;
    const lines = content.split("\n");
    const relPosix = rel.replace(/\\/g, "/");
    for (let i = 0; i < lines.length; i++) {
      if (matchCount >= max) break;
      re.lastIndex = 0;
      if (!re.test(lines[i]!)) continue;
      if (hits.length > 0) hits.push("--");
      hits.push(...formatJsGrepHit(relPosix, i + 1, lines, before, after));
      matchCount += 1;
    }
  }
  return {
    output: formatGrepOutput({ lines: hits, matchCount, max, emptyHint }),
    meta: { count: matchCount, engine: "js-fallback" },
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
      const rangeNote =
        h.startLine !== undefined
          ? `:${h.startLine}${h.endLine && h.endLine !== h.startLine ? `-${h.endLine}` : ""}`
          : "";
      const snippetNote = h.snippet ? `\n    ${h.snippet.split("\n").join("\n    ")}` : "";
      return `${i + 1}. ${h.path}${rangeNote} (score ${h.score.toFixed(2)})${symbolNote}${snippetNote}`;
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

function globToRegExpSource(pattern: string): string {
  return pattern
    .replace(/[.+^$()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/{{GLOBSTAR}}/g, ".*");
}

function matchOneGlob(relPath: string, pattern: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  const source = pat.includes("/")
    ? globToRegExpSource(pat)
    : `(?:.*/)?${globToRegExpSource(pat)}`;
  return new RegExp(`^${source}$`).test(normalized);
}

/** gitignore-style glob: `*.ts` matches nested files; `{ts,tsx}` braces are expanded. */
export function matchGlob(relPath: string, pattern: string): boolean {
  return expandBraceGlobs(pattern).some((alt) => matchOneGlob(relPath, alt));
}
