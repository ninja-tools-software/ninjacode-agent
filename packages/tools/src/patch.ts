import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";

export class StalePatch extends ToolError {
  constructor(message: string) {
    super(message, "stale_patch");
    this.name = "StalePatch";
  }
}

export class AmbiguousEdit extends ToolError {
  constructor(message: string) {
    super(message, "ambiguous_edit");
    this.name = "AmbiguousEdit";
  }
}

/** Generate a simple unified diff between old and new content. */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n");
  // Myers-lite: line-based LCS for reasonable files
  const lcs = computeLcs(a, b);
  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${a.length} +1,${b.length} @@`,
  ];
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length || j < b.length) {
    if (k < lcs.length && i < a.length && a[i] === lcs[k] && j < b.length && b[j] === lcs[k]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
      k++;
    } else if (j < b.length && (k >= lcs.length || b[j] !== lcs[k])) {
      lines.push(`+${b[j]}`);
      j++;
    } else if (i < a.length && (k >= lcs.length || a[i] !== lcs[k])) {
      lines.push(`-${a[i]}`);
      i++;
    } else {
      break;
    }
  }
  return lines.join("\n");
}

function computeLcs(a: string[], b: string[]): string[] {
  // Bound complexity for large files
  if (a.length * b.length > 400_000) {
    return [];
  }
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      else dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const out: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push(a[i - 1]!);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) i--;
    else j--;
  }
  return out.reverse();
}

/**
 * Apply a unified diff / multi-file patch.
 * Supports simple formats:
 * --- a/path
 * +++ b/path
 * @@ ...
 *  context / -old / +new
 */
export const applyPatchTool: Tool = {
  name: "apply_patch",
  description:
    "Apply a unified diff patch to one or more files. Prefer this for multi-hunk edits.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      patch: { type: "string", description: "Unified diff text" },
    },
    required: ["patch"],
  },
  target() {
    return "patch";
  },
  async execute(ctx, args): Promise<ToolResult> {
    const patch = String(args.patch ?? "");
    if (!patch.trim()) throw new ToolError("Empty patch", "invalid_args");

    const files = parseUnifiedDiff(patch);
    if (files.length === 0) throw new ToolError("No file hunks found in patch", "invalid_args");

    const applied: string[] = [];
    const diffs: Record<string, string> = {};
    const fileChanges: Record<string, { before: string; after: string }> = {};
    const snapshots = new Map<string, { existed: boolean; content: string }>();
    const planned: Array<{ rel: string; abs: string; before: string; after: string; existed: boolean }> = [];

    // Verify every path and hunk against one immutable snapshot before writing
    // anything. A stale later file can therefore never leave earlier files
    // transiently modified.
    const seen = new Set<string>();
    for (const file of files) {
      const rel = toWorkspaceRelative(ctx.workspaceRoot, file.path);
      if (seen.has(rel)) {
        throw new AmbiguousEdit(`Patch contains more than one file section for ${rel}`);
      }
      seen.add(rel);
      const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
      const { before, existed } = await readPatchTarget(abs, rel, file.isNew);
      const after = applyHunks(before, file.hunks);
      planned.push({ rel, abs, before, after, existed });
      snapshots.set(rel, { existed, content: before });
    }

    try {
      for (const { rel, abs, before, after } of planned) {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, after, "utf8");
        diffs[rel] = unifiedDiff(rel, before, after);
        fileChanges[rel] = { before, after };
        applied.push(rel);
      }
    } catch (e) {
      for (const [rel, snap] of snapshots) {
        const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
        if (snap.existed) {
          await fs.writeFile(abs, snap.content, "utf8").catch(() => undefined);
        } else {
          await fs.unlink(abs).catch(() => undefined);
        }
      }
      throw e;
    }

    return {
      output: `Applied patch to ${applied.length} file(s): ${applied.join(", ")}`,
      meta: { paths: applied, action: "patch", diffs, fileChanges, applied: true },
    };
  },
};

async function readPatchTarget(
  abs: string,
  rel: string,
  isNew: boolean,
): Promise<{ before: string; existed: boolean }> {
  try {
    return { before: await fs.readFile(abs, "utf8"), existed: true };
  } catch {
    if (!isNew) throw new ToolError(`File not found: ${rel}`, "not_found");
    return { before: "", existed: false };
  }
}

export interface ParsedFile {
  path: string;
  isNew: boolean;
  hunks: ParsedHunk[];
}

export interface ParsedHunk {
  lines: string[];
  oldStart?: number;
  oldCount?: number;
  newStart?: number;
  newCount?: number;
}

export function parseUnifiedDiff(patch: string): ParsedFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let hunk: ParsedHunk | null = null;
  let oldPath: string | undefined;

  const flushHunk = () => {
    if (current && hunk && hunk.lines.length) {
      current.hunks.push(hunk);
    }
    hunk = null;
  };

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      flushHunk();
      current = null;
      oldPath = line.slice(4).trim();
      continue;
    }
    if (line.startsWith("+++ ")) {
      flushHunk();
      let p = line.slice(4).trim();
      if (p.startsWith("b/")) p = p.slice(2);
      if (p === "/dev/null") continue;
      current = { path: p, isNew: oldPath === "/dev/null", hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("@@")) {
      flushHunk();
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      hunk = match
        ? {
            lines: [],
            oldStart: Number(match[1]),
            oldCount: match[2] === undefined ? 1 : Number(match[2]),
            newStart: Number(match[3]),
            newCount: match[4] === undefined ? 1 : Number(match[4]),
          }
        : { lines: [] };
      continue;
    }
    if (current && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === "\\ No newline at end of file")) {
      (hunk ??= { lines: [] }).lines.push(line);
    }
  }
  flushHunk();

  // Tolerate the common headerless new-file form while retaining /dev/null as
  // the authoritative signal.
  for (const f of files) {
    const all = f.hunks.flatMap((h) => h.lines);
    f.isNew ||= all.length > 0 && all.every((l) => l.startsWith("+") || l.startsWith("\\"));
  }
  return files;
}

export function applyHunks(before: string, hunks: ParsedHunk[]): string {
  if (hunks.length === 0) return before;
  const trailingNewline = before.endsWith("\n") || before.length === 0;
  const contentLines = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  let lineDelta = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((l) => l.startsWith(" ") || l.startsWith("-"))
      .map((l) => l.slice(1));
    const newLines = hunk.lines
      .filter((l) => l.startsWith(" ") || l.startsWith("+"))
      .map((l) => l.slice(1));

    validateHunkCounts(hunk, oldLines.length, newLines.length);
    const expected =
      hunk.oldStart === undefined
        ? undefined
        : Math.max(0, Math.min(contentLines.length, hunk.oldStart - 1 + lineDelta));
    const index =
      oldLines.length === 0
        ? expected ?? contentLines.length
        : locateHunk(contentLines, oldLines, expected);
    contentLines.splice(index, oldLines.length, ...newLines);
    lineDelta += newLines.length - oldLines.length;
  }

  const content = contentLines.join("\n");
  return trailingNewline && content ? `${content}\n` : content;
}

function validateHunkCounts(hunk: ParsedHunk, oldCount: number, newCount: number): void {
  if (hunk.oldCount !== undefined && hunk.oldCount !== oldCount) {
    throw new StalePatch(
      `Hunk declares ${hunk.oldCount} old line(s) but contains ${oldCount}`,
    );
  }
  if (hunk.newCount !== undefined && hunk.newCount !== newCount) {
    throw new StalePatch(
      `Hunk declares ${hunk.newCount} new line(s) but contains ${newCount}`,
    );
  }
}

function blockMatches(
  content: string[],
  needle: string[],
  start: number,
  normalize = false,
): boolean {
  if (start < 0 || start + needle.length > content.length) return false;
  return needle.every((line, offset) => {
    const candidate = content[start + offset]!;
    return normalize ? normalizeLine(candidate) === normalizeLine(line) : candidate === line;
  });
}

function candidateStarts(content: string[], needle: string[], normalize = false): number[] {
  const candidates: number[] = [];
  for (let start = 0; start + needle.length <= content.length; start++) {
    if (blockMatches(content, needle, start, normalize)) candidates.push(start);
  }
  return candidates;
}

function chooseCandidate(candidates: number[], expected: number | undefined): number {
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) return -1;
  if (expected === undefined) {
    throw new AmbiguousEdit("Hunk context is ambiguous; add offsets or more unchanged context");
  }
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: Math.abs(candidate - expected) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked[0]!.distance === ranked[1]!.distance) {
    throw new AmbiguousEdit("Hunk offset is equally close to multiple matching occurrences");
  }
  return ranked[0]!.candidate;
}

function locateHunk(content: string[], oldLines: string[], expected: number | undefined): number {
  if (expected !== undefined && blockMatches(content, oldLines, expected)) return expected;

  const exact = chooseCandidate(candidateStarts(content, oldLines), expected);
  if (exact !== -1) return exact;

  if (expected !== undefined && blockMatches(content, oldLines, expected, true)) return expected;
  const normalized = chooseCandidate(candidateStarts(content, oldLines, true), expected);
  if (normalized !== -1) return normalized;

  throw new StalePatch(
    `Hunk context not found (patch is stale):\n${oldLines.slice(0, 3).join("\n")}`,
  );
}

function normalizeLine(value: string): string {
  return value.replace(/[ \t]+/g, " ").trim();
}

/** Helper used by write/edit tools to attach diffs. */
export async function writeWithDiff(
  ctx: ToolContext,
  rel: string,
  content: string,
): Promise<{ before: string; after: string; diff: string; existed: boolean }> {
  const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
  let before = "";
  let existed = true;
  try {
    before = await fs.readFile(abs, "utf8");
  } catch {
    existed = false;
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return {
    before,
    after: content,
    diff: unifiedDiff(rel, before, content),
    existed,
  };
}
