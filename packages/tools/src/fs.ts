import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";
import { isSkippedDir } from "./ignore.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";
import { writeWithDiff } from "./patch.js";

function relPath(ctx: ToolContext, relOrAbs: string): string {
  return toWorkspaceRelative(ctx.workspaceRoot, relOrAbs);
}

function verifyJsonFile(rel: string, content: string): string | undefined {
  try {
    JSON.parse(content);
  } catch (e) {
    return `JSON parse error in ${rel}: ${(e as Error).message}`;
  }
  return undefined;
}

function verifyHtmlFile(rel: string, content: string): string | undefined {
  if (!/<html[\s>]/i.test(content)) return `${rel}: missing <html> root element`;
  const opens = (content.match(/<script\b/gi) ?? []).length;
  const closes = (content.match(/<\/script>/gi) ?? []).length;
  if (opens !== closes) return `${rel}: unbalanced <script> tags (${opens} open, ${closes} close)`;
  return undefined;
}

function verifyScriptFile(rel: string, content: string): string | undefined {
  const scriptBody = content.replace(/<script[\s\S]*?<\/script>/gi, "");
  const backticks = (scriptBody.match(/`/g) ?? []).length;
  if (backticks % 2 !== 0) return `${rel}: possible unclosed template literal`;
  const parens =
    (scriptBody.match(/\(/g) ?? []).length - (scriptBody.match(/\)/g) ?? []).length;
  const braces =
    (scriptBody.match(/\{/g) ?? []).length - (scriptBody.match(/\}/g) ?? []).length;
  const brackets =
    (scriptBody.match(/\[/g) ?? []).length - (scriptBody.match(/\]/g) ?? []).length;
  if (parens !== 0 || braces !== 0 || brackets !== 0) {
    return `${rel}: unbalanced brackets (parens=${parens}, braces=${braces}, brackets=${brackets})`;
  }
  return undefined;
}

const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/** Minimal syntax sanity check after writing code files. */
function verifyWrittenFile(rel: string, content: string): string | undefined {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".json") return verifyJsonFile(rel, content);
  if (ext === ".html" || ext === ".htm") return verifyHtmlFile(rel, content);
  if (SCRIPT_EXTENSIONS.has(ext)) return verifyScriptFile(rel, content);
  return undefined;
}

/** Soft cap on a single read_file result; paginate with offset when hit. */
export const READ_FILE_MAX_CHARS = 40_000;

/** Cap per numbered line so one minified line cannot exhaust the budget. */
const MAX_LINE_CHARS = 2_000;

/** Room reserved so the pagination footer never pushes the result over the harness cap. */
const READ_FOOTER_RESERVE = 160;

function countFileLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n");
  if (lines.length > 1 && lines.at(-1) === "" && content.endsWith("\n")) {
    return lines.length - 1;
  }
  return lines.length;
}

function formatReadFooter(opts: {
  offset: number;
  endLine: number;
  totalLines: number;
  partial: boolean;
}): string {
  if (!opts.partial || opts.endLine < opts.offset) return "";
  if (opts.endLine >= opts.totalLines) {
    return `[showing lines ${opts.offset}-${opts.totalLines} of ${opts.totalLines} total — end of file]`;
  }
  return `[showing lines ${opts.offset}-${opts.endLine} of ${opts.totalLines} total — continue with offset=${opts.endLine + 1}]`;
}

function formatNumberedLine(lineNo: number, text: string): string {
  if (text.length <= MAX_LINE_CHARS) return `${lineNo}|${text}`;
  const omitted = text.length - MAX_LINE_CHARS;
  return `${lineNo}|${text.slice(0, MAX_LINE_CHARS)}…[+${omitted} chars on this line]`;
}

/** Accumulate numbered lines until the char budget; always stop on a line boundary. */
function renderReadSlice(opts: {
  lines: string[];
  offset: number;
  maxChars: number;
}): { body: string; endLine: number; budgetTruncated: boolean } {
  const { lines, offset, maxChars } = opts;
  if (lines.length === 0) return { body: "", endLine: offset - 1, budgetTruncated: false };

  const parts: string[] = [];
  let used = 0;
  let endLine = offset - 1;
  for (let i = 0; i < lines.length; i++) {
    const numbered = formatNumberedLine(offset + i, lines[i]!);
    const extra = parts.length === 0 ? numbered.length : numbered.length + 1;
    if (parts.length > 0 && used + extra > maxChars) {
      return { body: parts.join("\n"), endLine, budgetTruncated: true };
    }
    parts.push(numbered);
    used += extra;
    endLine = offset + i;
  }
  return { body: parts.join("\n"), endLine, budgetTruncated: false };
}

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read a file from the workspace. Returns numbered lines (N|content), up to ~40k chars per call. " +
    "When truncated, a footer gives the next offset to continue. Optionally pass offset/limit for a line range. " +
    "Use workspace-relative paths (e.g. src/app.ts).",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path from workspace root" },
      offset: { type: "number", description: "1-based start line (optional)" },
      limit: { type: "number", description: "Max number of lines (optional)" },
    },
    required: ["path"],
  },
  target(args) {
    return String(args.path ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const rel = relPath(ctx, String(args.path ?? ""));
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch (e) {
      throw new ToolError(`Cannot read ${rel}: ${(e as Error).message}`, "not_found");
    }
    const lines = content.split("\n");
    const totalLines = countFileLines(content);
    const hasOffset = typeof args.offset === "number";
    const hasLimit = typeof args.limit === "number";
    const offset = hasOffset ? Math.max(1, args.offset as number) : 1;
    if (totalLines > 0 && offset > totalLines) {
      throw new ToolError(
        `offset ${offset} is beyond the end of ${rel} (${totalLines} lines)`,
        "invalid_args",
      );
    }
    if (totalLines === 0 && offset > 1) {
      throw new ToolError(`offset ${offset} is beyond the end of ${rel} (0 lines)`, "invalid_args");
    }
    const limit = hasLimit ? (args.limit as number) : Math.max(0, totalLines - offset + 1);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const rendered = renderReadSlice({
      lines: slice,
      offset,
      maxChars: READ_FILE_MAX_CHARS - READ_FOOTER_RESERVE,
    });
    const endLine = rendered.endLine;
    const partial = rendered.budgetTruncated || hasOffset || hasLimit;
    const footer = formatReadFooter({ offset, endLine, totalLines, partial });
    const body = rendered.body || "(empty file)";
    const servedLines = endLine >= offset ? endLine - offset + 1 : 0;
    return {
      output: footer ? `${body}\n${footer}` : body,
      meta: {
        path: rel,
        startLine: offset,
        endLine,
        lines: servedLines,
        totalLines,
      },
    };
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create or overwrite a file in the workspace. Use workspace-relative paths only.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  target(args) {
    return String(args.path ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const rel = relPath(ctx, String(args.path ?? ""));
    const content = String(args.content ?? "");
    const result = await writeWithDiff(ctx, rel, content);
    const verifyError = verifyWrittenFile(rel, content);
    const verifyNote = verifyError ? `\n\nVerification warning: ${verifyError}` : "";
    return {
      output: `Wrote ${content.length} bytes to ${rel}${verifyNote}`,
      meta: {
        path: rel,
        bytes: content.length,
        action: "write",
        diff: result.diff,
        before: result.before,
        after: result.after,
        verifyError,
        applied: true,
      },
    };
  },
};

export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Replace an exact string occurrence in a file. Fails if old_string is not found uniquely (unless replace_all). Use workspace-relative paths.",
  risk: "write",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path" },
      old_string: { type: "string" },
      new_string: { type: "string" },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_string", "new_string"],
  },
  target(args) {
    return String(args.path ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const rel = relPath(ctx, String(args.path ?? ""));
    const oldStr = String(args.old_string ?? "");
    const newStr = String(args.new_string ?? "");
    const replaceAll = Boolean(args.replace_all);
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
    let content: string;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch (e) {
      throw new ToolError(`Cannot read ${rel}: ${(e as Error).message}`, "not_found");
    }
    const count = content.split(oldStr).length - 1;
    if (count === 0) {
      throw new ToolError(`old_string not found in ${rel}`, "invalid_args");
    }
    if (count > 1 && !replaceAll) {
      throw new ToolError(
        `old_string found ${count} times in ${rel}; set replace_all or provide more context`,
        "invalid_args",
      );
    }
    const next = replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr);
    const result = await writeWithDiff(ctx, rel, next);
    const verifyError = verifyWrittenFile(rel, next);
    const verifyNote = verifyError ? `\nVerification warning: ${verifyError}` : "";
    return {
      output: `Edited ${rel} (${replaceAll ? count : 1} replacement(s))${verifyNote ? `. ${verifyNote}` : ""}`,
      meta: {
        path: rel,
        replacements: replaceAll ? count : 1,
        action: "edit",
        diff: result.diff,
        before: result.before,
        after: result.after,
        verifyError,
        applied: true,
      },
    };
  },
};

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file from the workspace. Use workspace-relative paths only.",
  risk: "destructive",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative path" },
    },
    required: ["path"],
  },
  target(args) {
    return String(args.path ?? "");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const rel = relPath(ctx, String(args.path ?? ""));
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
    let before = "";
    try {
      before = await fs.readFile(abs, "utf8");
    } catch (e) {
      throw new ToolError(`Cannot delete ${rel}: ${(e as Error).message}`, "not_found");
    }
    await fs.unlink(abs);
    return {
      output: `Deleted ${rel}`,
      meta: {
        path: rel,
        action: "delete",
        before,
        applied: true,
      },
    };
  },
};

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List files and directories under a path (non-recursive by default). Use workspace-relative paths.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative directory path (default: .)" },
      recursive: { type: "boolean" },
    },
  },
  target(args) {
    return String(args.path ?? ".");
  },
  async execute(ctx, args): Promise<ToolResult> {
    const rel = relPath(ctx, String(args.path ?? "."));
    const abs = resolveInWorkspace(ctx.workspaceRoot, rel);
    const recursive = Boolean(args.recursive);
    const entries: string[] = [];
    const root = path.resolve(ctx.workspaceRoot);

    async function walk(dir: string, depth: number) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (isSkippedDir(item.name)) continue;
        const absChild = path.join(dir, item.name);
        const relPathEntry = toWorkspaceRelative(root, absChild);
        entries.push(item.isDirectory() ? `${relPathEntry}/` : relPathEntry);
        if (recursive && item.isDirectory() && depth < 6) {
          await walk(absChild, depth + 1);
        }
      }
    }

    try {
      await walk(abs, 0);
    } catch (e) {
      throw new ToolError(`Cannot list ${rel}: ${(e as Error).message}`, "not_found");
    }
    return { output: entries.join("\n") || "(empty)", meta: { count: entries.length, path: rel } };
  },
};
