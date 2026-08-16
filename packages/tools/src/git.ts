import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { buildExecutionEnv, sandboxCommand } from "./sandbox.js";
import { resolveInWorkspace, toWorkspaceRelative } from "./paths.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolError } from "./types.js";

const OUTPUT_LIMIT = 80_000;
const ERROR_LIMIT = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;

interface GitRequest {
  command: string;
  args: string[];
  repository: string;
}

class BoundedText {
  private value = "";
  private omitted = 0;

  constructor(private readonly limit: number) {}

  append(chunk: Buffer): void {
    const text = chunk.toString("utf8");
    const remaining = Math.max(0, this.limit - this.value.length);
    this.value += text.slice(0, remaining);
    this.omitted += Math.max(0, text.length - remaining);
  }

  result(): { text: string; truncated: boolean } {
    if (this.omitted === 0) return { text: this.value, truncated: false };
    return {
      text: `${this.value}\n…[truncated ${this.omitted} chars]`,
      truncated: true,
    };
  }
}

function resolveRepository(ctx: ToolContext, args: Record<string, unknown>): string {
  try {
    return resolveInWorkspace(ctx.workspaceRoot, String(args.repository ?? "."));
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError("Invalid repository path", "invalid_args");
  }
}

function resolvePathspec(
  ctx: ToolContext,
  repository: string,
  value: unknown,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const absolute = resolveInWorkspace(ctx.workspaceRoot, String(value));
  const relative = path.relative(repository, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolError("path must be inside repository", "permission");
  }
  return relative || ".";
}

function optionalRevision(value: unknown, fallback?: string): string | undefined {
  const revision = value === undefined || value === null || value === "" ? fallback : String(value);
  if (revision === undefined) return undefined;
  const hasControlCharacter = [...revision].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    revision.length > 256 ||
    revision.startsWith("-") ||
    hasControlCharacter
  ) {
    throw new ToolError("Invalid Git revision", "invalid_args");
  }
  return revision;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`Expected an integer between ${min} and ${max}`, "invalid_args");
  }
  return value;
}

function gitArgs(command: string, args: string[]): string[] {
  return [
    "--no-pager",
    "--no-optional-locks",
    "--literal-pathspecs",
    "-c",
    "color.ui=false",
    command,
    ...args,
  ];
}

function formatGitError(command: string, code: number | null, stderr: string): ToolError {
  const detail = stderr.trim() || `git ${command} exited with code ${code ?? "unknown"}`;
  if (/not a git repository/u.test(detail)) {
    return new ToolError(detail, "not_found");
  }
  if (/unknown revision|bad revision|ambiguous argument|invalid object name/u.test(detail)) {
    return new ToolError(detail, "not_found");
  }
  return new ToolError(detail, "runtime");
}

function executeGit(ctx: ToolContext, request: GitRequest): Promise<ToolResult> {
  if (ctx.signal?.aborted) {
    return Promise.reject(new ToolError("Git command aborted", "aborted"));
  }

  const env = buildExecutionEnv(process.env, {
    GIT_CEILING_DIRECTORIES: path.dirname(resolveInWorkspace(ctx.workspaceRoot, ".")),
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  });
  const wrapped = sandboxCommand({
    command: "git",
    args: gitArgs(request.command, request.args),
    cwd: request.repository,
    workspaceRoot: ctx.workspaceRoot,
    agentDir: ctx.agentDir,
    mode: ctx.sandboxMode === "danger-full-access" ? "danger-full-access" : "read-only",
    allowNetwork: false,
    env,
    sessionId: ctx.sessionId,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(wrapped.command, wrapped.args, {
      cwd: request.repository,
      env,
      signal: ctx.signal,
      detached: false,
    }) as ChildProcessWithoutNullStreams;
    const stdout = new BoundedText(OUTPUT_LIMIT);
    const stderr = new BoundedText(ERROR_LIMIT);
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new ToolError(`Git command timed out after ${DEFAULT_TIMEOUT_MS}ms`, "timeout")));
    }, DEFAULT_TIMEOUT_MS);

    child.on("error", (error) => {
      finish(() => {
        const code = error.name === "AbortError" ? "aborted" : "runtime";
        reject(new ToolError(error.name === "AbortError" ? "Git command aborted" : error.message, code));
      });
    });
    child.on("close", (code) => {
      finish(() => {
        const errorOutput = stderr.result().text;
        if (code !== 0) {
          reject(formatGitError(request.command, code, errorOutput));
          return;
        }
        const captured = stdout.result();
        resolve({
          output: captured.text || "(no output)",
          meta: {
            command: request.command,
            repository: toWorkspaceRelative(ctx.workspaceRoot, request.repository),
            truncated: captured.truncated,
            sandboxed: wrapped.sandboxed,
          },
        });
      });
    });
  });
}

const repositoryProperty = {
  type: "string",
  description: "Repository directory relative to the workspace (default: workspace root)",
};
const pathProperty = {
  type: "string",
  description: "Optional path inside the repository, relative to the workspace",
};

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Show bounded porcelain Git status for a repository in the workspace.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: { repository: repositoryProperty, path: pathProperty },
  },
  target: (args) => String(args.repository ?? "."),
  async execute(ctx, args) {
    const repository = resolveRepository(ctx, args);
    const pathspec = resolvePathspec(ctx, repository, args.path);
    const commandArgs = ["--short", "--branch", "--untracked-files=normal"];
    if (pathspec) commandArgs.push("--", pathspec);
    return executeGit(ctx, { command: "status", args: commandArgs, repository });
  },
};

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show a bounded Git diff without external diff drivers or text conversion.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      repository: repositoryProperty,
      path: pathProperty,
      ref: { type: "string", description: "Optional revision to compare with the working tree" },
      staged: { type: "boolean", description: "Compare the index instead of the working tree" },
      context_lines: { type: "integer", minimum: 0, maximum: 20, default: 3 },
    },
  },
  target: (args) => `${String(args.repository ?? ".")}:${String(args.ref ?? "working-tree")}`,
  async execute(ctx, args) {
    const repository = resolveRepository(ctx, args);
    const pathspec = resolvePathspec(ctx, repository, args.path);
    const revision = optionalRevision(args.ref);
    const contextLines = boundedInteger(args.context_lines, 3, 0, 20);
    const commandArgs = ["--no-ext-diff", "--no-textconv", "--no-renames", `--unified=${contextLines}`];
    if (args.staged === true) commandArgs.push("--cached");
    if (revision) commandArgs.push(revision);
    if (pathspec) commandArgs.push("--", pathspec);
    return executeGit(ctx, { command: "diff", args: commandArgs, repository });
  },
};

export const gitLogTool: Tool = {
  name: "git_log",
  description: "List bounded structured commit history as hash, author, ISO date, and subject.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      repository: repositoryProperty,
      path: pathProperty,
      ref: { type: "string", description: "Revision to start from (default: HEAD)" },
      max_count: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
  },
  target: (args) => `${String(args.repository ?? ".")}:${String(args.ref ?? "HEAD")}`,
  async execute(ctx, args) {
    const repository = resolveRepository(ctx, args);
    const pathspec = resolvePathspec(ctx, repository, args.path);
    const revision = optionalRevision(args.ref, "HEAD")!;
    const maxCount = boundedInteger(args.max_count, 20, 1, 100);
    const commandArgs = [
      `--max-count=${maxCount}`,
      "--date=iso-strict",
      "--format=%H%x09%an%x09%aI%x09%s",
      revision,
    ];
    if (pathspec) commandArgs.push("--", pathspec);
    return executeGit(ctx, { command: "log", args: commandArgs, repository });
  },
};

export const gitShowTool: Tool = {
  name: "git_show",
  description: "Show one bounded commit with metadata, stat, and patch using safe Git options.",
  risk: "read_only",
  inputSchema: {
    type: "object",
    properties: {
      repository: repositoryProperty,
      path: pathProperty,
      revision: { type: "string", description: "Commit or object revision (default: HEAD)" },
      context_lines: { type: "integer", minimum: 0, maximum: 20, default: 3 },
    },
  },
  target: (args) => `${String(args.repository ?? ".")}:${String(args.revision ?? "HEAD")}`,
  async execute(ctx, args) {
    const repository = resolveRepository(ctx, args);
    const pathspec = resolvePathspec(ctx, repository, args.path);
    const revision = optionalRevision(args.revision, "HEAD")!;
    const contextLines = boundedInteger(args.context_lines, 3, 0, 20);
    const commandArgs = [
      "--format=fuller",
      "--stat",
      "--patch",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      `--unified=${contextLines}`,
      revision,
    ];
    if (pathspec) commandArgs.push("--", pathspec);
    return executeGit(ctx, { command: "show", args: commandArgs, repository });
  },
};
