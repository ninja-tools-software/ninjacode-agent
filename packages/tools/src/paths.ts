import fs from "node:fs";
import path from "node:path";
import { ToolError } from "./types.js";

/** Normalize slashes and strip leading `./`. */
export function normalizePathSlashes(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function assertInsideRoot(root: string, candidate: string, label: string): void {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new ToolError(`Path escapes workspace: ${label}`, "permission");
  }
}

/** Resolve symlinks for an existing prefix; append missing trailing segments. */
function resolveWithRealpath(candidate: string): string {
  let current = candidate;
  const missing: string[] = [];
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        throw new ToolError(`Path not resolvable: ${candidate}`, "permission");
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolve a workspace-relative or absolute path inside the workspace.
 * Follows symlinks and rejects paths that escape the workspace root.
 */
export function resolveInWorkspace(workspaceRoot: string, relOrAbs: string): string {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const input = String(relOrAbs ?? "").trim();
  if (!input) throw new ToolError("Path is required", "invalid_args");

  // Resolve then realpath so macOS /var → /private/var aliases stay consistent.
  const lexical = path.isAbsolute(input) ? path.resolve(input) : path.resolve(root, input);
  const real = resolveWithRealpath(lexical);
  assertInsideRoot(root, real, relOrAbs);
  return real;
}

/**
 * Convert an absolute or relative path to a stable workspace-relative path
 * (forward slashes, no leading `./`).
 */
export function toWorkspaceRelative(workspaceRoot: string, relOrAbs: string): string {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const resolved = resolveInWorkspace(workspaceRoot, relOrAbs);
  if (resolved === root) return ".";
  const rel = path.relative(root, resolved);
  return normalizePathSlashes(rel);
}

/** Join workspace root with a relative path safely (never double-join absolutes). */
export function joinWorkspace(workspaceRoot: string, relOrAbs: string): string {
  return resolveInWorkspace(workspaceRoot, relOrAbs);
}
