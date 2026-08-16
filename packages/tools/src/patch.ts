import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";

/** Generate a simple unified diff between old and new content. */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // Myers-lite: line-based LCS for reasonable files
  const lcs = computeLcs(a, b);
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`, "@@ @@"];
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

    try {
      for (const file of files) {
        const rel = toWorkspaceRelative(ctx.workspaceRoot, file.path);
        const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
        const { before, existed } = await readPatchTarget(abs, rel, file.isNew);
        snapshots.set(rel, { existed, content: before });
        const after = applyHunks(before, file.hunks);
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
  hunks: Array<{ lines: string[] }>;
}

export function parseUnifiedDiff(patch: string): ParsedFile[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: ParsedFile[] = [];
  let current: ParsedFile | null = null;
  let hunkLines: string[] = [];

  const flushHunk = () => {
    if (current && hunkLines.length) {
      current.hunks.push({ lines: hunkLines });
      hunkLines = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      flushHunk();
      current = null;
      continue;
    }
    if (line.startsWith("+++ ")) {
      flushHunk();
      let p = line.slice(4).trim();
      if (p.startsWith("b/")) p = p.slice(2);
      if (p === "/dev/null") continue;
      current = { path: p, isNew: false, hunks: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("@@")) {
      flushHunk();
      continue;
    }
    if (current && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line === "\\ No newline at end of file")) {
      hunkLines.push(line);
    }
  }
  flushHunk();

  // Detect new files (all additions)
  for (const f of files) {
    const all = f.hunks.flatMap((h) => h.lines);
    f.isNew = all.length > 0 && all.every((l) => l.startsWith("+") || l.startsWith("\\"));
  }
  return files;
}

export function applyHunks(before: string, hunks: Array<{ lines: string[] }>): string {
  if (hunks.length === 0) return before;
  // Reconstruct from hunks: start from empty and apply + and context, skip -
  // For robustness: if file empty / new, just take all + lines
  const allLines = hunks.flatMap((h) => h.lines);
  const onlyAdds = allLines.every((l) => l.startsWith("+") || l.startsWith("\\") || l.startsWith(" "));
  if (!before && onlyAdds) {
    return allLines.filter((l) => l.startsWith("+")).map((l) => l.slice(1)).join("\n") + (allLines.some((l) => l.startsWith("+")) ? "\n" : "");
  }

  let content = before;
  // Apply each hunk by locating context
  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((l) => l.startsWith(" ") || l.startsWith("-"))
      .map((l) => l.slice(1));
    const newLines = hunk.lines
      .filter((l) => l.startsWith(" ") || l.startsWith("+"))
      .map((l) => l.slice(1));
    const oldBlock = oldLines.join("\n");
    const newBlock = newLines.join("\n");
    if (!oldBlock) {
      // pure insert at end
      content = content.endsWith("\n") || content === "" ? content + newBlock : content + "\n" + newBlock;
      if (!content.endsWith("\n") && newBlock) content += "\n";
      continue;
    }
    const idx = findContextIndex(content, oldBlock);
    if (idx === -1) {
      throw new ToolError(
        `Hunk context not found in file (patch may be stale):\n${oldLines.slice(0, 3).join("\n")}`,
        "invalid_args",
      );
    }
    content = content.slice(0, idx) + newBlock + content.slice(idx + oldBlock.length);
  }
  return content;
}

function uniqueBlockIndex(haystack: string, needle: string): number {
  let match = -1;
  let offset = 0;
  while (offset <= haystack.length) {
    const candidate = haystack.indexOf(needle, offset);
    if (candidate === -1) break;
    const startsOnLine = candidate === 0 || haystack[candidate - 1] === "\n";
    const end = candidate + needle.length;
    const endsOnLine = end === haystack.length || haystack[end] === "\n";
    if (startsOnLine && endsOnLine) {
      if (match !== -1) {
        throw new ToolError(
          "Hunk context is ambiguous; add more unchanged context around the edit",
          "invalid_args",
        );
      }
      match = candidate;
    }
    offset = candidate + 1;
  }
  return match;
}

/** Unique exact match first, then a unique whitespace-normalized match. */
function findContextIndex(content: string, oldBlock: string): number {
  const exact = uniqueBlockIndex(content, oldBlock);
  if (exact !== -1) return exact;

  const normContent = normalizeWs(content);
  const normBlock = normalizeWs(oldBlock);
  if (!normBlock) return -1;
  const normIdx = uniqueBlockIndex(normContent, normBlock);
  if (normIdx === -1) return -1;

  // Map normalized index back to original — approximate by line offset
  const linesBefore = normContent.slice(0, normIdx).split("\n").length - 1;
  const contentLines = content.split("\n");
  const blockLineCount = oldBlock.split("\n").length;
  const candidate = contentLines.slice(linesBefore, linesBefore + blockLineCount).join("\n");
  if (normalizeWs(candidate) === normBlock) {
    return content.indexOf(candidate);
  }
  return -1;
}

function normalizeWs(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
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
