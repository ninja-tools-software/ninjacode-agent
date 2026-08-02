import path from "node:path";
import type { DiagnosticEntry, DiagnosticsProvider, Tool, ToolContext, ToolResult } from "./types.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";
import { spawnCapture } from "./process.js";

export type { DiagnosticEntry, DiagnosticsProvider };

export function formatDiagnostics(entries: DiagnosticEntry[]): string {
  if (entries.length === 0) return "No diagnostics.";
  return entries
    .map((d) => {
      const sev = d.severity.toUpperCase();
      const src = d.source ? ` (${d.source})` : "";
      return `${d.path}:${d.line}:${d.column} [${sev}]${src}: ${d.message}`;
    })
    .join("\n");
}

export async function collectDiagnostics(
  ctx: ToolContext,
  paths?: string[],
): Promise<DiagnosticEntry[]> {
  if (ctx.diagnosticsProvider) {
    return ctx.diagnosticsProvider(paths);
  }
  return fallbackCliDiagnostics(ctx, paths);
}

const TSC_LINE =
  /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)$/;

function parseTscDiagnosticLine(
  line: string,
  root: string,
  paths?: string[],
): DiagnosticEntry | null {
  const m = line.match(TSC_LINE);
  if (!m) return null;
  const rel = toWorkspaceRelative(root, m[1]!.trim());
  if (paths?.length && !paths.some((p) => rel === p || rel.endsWith(p))) return null;
  return {
    path: rel,
    line: Number(m[2]),
    column: Number(m[3]),
    severity: m[4] === "warning" ? "warning" : "error",
    message: m[5]!,
    source: "typescript",
  };
}

async function collectTscDiagnostics(
  root: string,
  signal: AbortSignal | undefined,
  paths?: string[],
): Promise<DiagnosticEntry[]> {
  const tsconfig = path.join(root, "tsconfig.json");
  try {
    await import("node:fs/promises").then((fs) => fs.access(tsconfig));
  } catch {
    return [];
  }
  const out = await execCapture("npx", ["tsc", "--noEmit", "--pretty", "false"], root, signal);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => parseTscDiagnosticLine(line, root, paths))
    .filter((entry): entry is DiagnosticEntry => entry !== null);
}

async function validateJsonPath(
  root: string,
  relPath: string,
): Promise<DiagnosticEntry | null> {
  const rel = toWorkspaceRelative(root, relPath);
  if (!rel.endsWith(".json")) return null;
  const abs = resolveInWorkspace(root, rel);
  let content: string;
  try {
    content = await import("node:fs/promises").then((fs) => fs.readFile(abs, "utf8"));
  } catch {
    return null;
  }
  try {
    JSON.parse(content);
    return null;
  } catch (e) {
    return {
      path: rel,
      line: 1,
      column: 1,
      severity: "error",
      message: (e as Error).message,
      source: "json",
    };
  }
}

async function collectJsonDiagnostics(
  root: string,
  paths: string[],
): Promise<DiagnosticEntry[]> {
  const entries: DiagnosticEntry[] = [];
  for (const p of paths) {
    const entry = await validateJsonPath(root, p);
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Best-effort CLI fallback when no IDE diagnostics provider is wired. */
async function fallbackCliDiagnostics(
  ctx: ToolContext,
  paths?: string[],
): Promise<DiagnosticEntry[]> {
  const root = ctx.workspaceRoot;
  const entries = await collectTscDiagnostics(root, ctx.signal, paths);
  if (entries.length > 0 || !paths?.length) return entries;
  return collectJsonDiagnostics(root, paths);
}

/** Linters report findings on stdout, but some write to stderr instead. */
async function execCapture(
  cmd: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await spawnCapture(cmd, args, {
    cwd,
    signal,
    shell: process.platform === "win32",
  });
  return result.stdout || result.stderr;
}

export const readLintsTool: Tool = {
  name: "read_lints",
  description:
    "Read linter and type-checker diagnostics for workspace files. " +
    "Omit path to scan the whole workspace; pass path or paths for targeted checks.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Single workspace-relative file path" },
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Multiple workspace-relative paths",
      },
    },
  },
  target(args) {
    if (Array.isArray(args.paths)) return (args.paths as string[]).join(",");
    return String(args.path ?? "*");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const paths = Array.isArray(args.paths)
      ? (args.paths as string[]).map((p) => toWorkspaceRelative(ctx.workspaceRoot, String(p)))
      : args.path
        ? [toWorkspaceRelative(ctx.workspaceRoot, String(args.path))]
        : undefined;

    const entries = await collectDiagnostics(ctx, paths);
    const errors = entries.filter((e) => e.severity === "error");
    const warnings = entries.filter((e) => e.severity === "warning");
    const output = formatDiagnostics(entries);
    return {
      output,
      meta: {
        count: entries.length,
        errors: errors.length,
        warnings: warnings.length,
        paths: [...new Set(entries.map((e) => e.path))],
      },
    };
  },
};
