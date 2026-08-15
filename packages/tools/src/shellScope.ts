/**
 * Turns a shell command into "grant scopes" for per-type "always approve"
 * decisions. A scope is either a bare program name (`grep`) or, for tools that
 * dispatch on a subcommand, `"program subcommand"` (`git status`).
 *
 * Matching is intentionally coarse and best-effort: when the command is too
 * dynamic to reason about safely (subshells, command substitution, empty
 * segments) we return `[]`, which makes the caller fall back to remembering the
 * exact command string instead of a whole command type.
 */

import {
  canonicalizeShellCommand,
  isNonGrantableShellCommand,
  parseShellInvocation,
  splitShellSegments,
} from "./shellParse.js";

/** Programs whose first non-flag argument selects a distinct capability. */
const SUBCOMMAND_PROGRAMS = new Set([
  "git",
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "docker",
  "docker-compose",
  "kubectl",
  "cargo",
  "go",
  "gh",
  "brew",
  "apt",
  "apt-get",
  "pip",
  "pip3",
  "poetry",
  "terraform",
  "systemctl",
  "gcloud",
  "aws",
  "dotnet",
  "make",
  "bun",
  "deno",
]);

/** Metacharacters that make a token untrustworthy as a program name. */
const UNSAFE_TOKEN = /[$`()<>*?{}[\]!~]/;

export { splitShellSegments };

/**
 * Program name plus remaining arguments for one segment, with leading
 * `VAR=value` assignments skipped. Null when no program can be read.
 */
export function segmentProgram(segment: string): { program: string; args: string[] } | null {
  return parseShellInvocation(segment);
}

/** Scope for a single command segment (no pipes/operators), or null if unparseable. */
function segmentScope(segment: string): string | null {
  const parsed = parseShellInvocation(segment);
  if (!parsed || UNSAFE_TOKEN.test(parsed.program)) return null;
  const { program, args } = parsed;

  if (SUBCOMMAND_PROGRAMS.has(program)) {
    const next = args[0];
    if (next && !next.startsWith("-") && !UNSAFE_TOKEN.test(next)) {
      return `${program} ${next}`;
    }
  }
  return program;
}

/**
 * Compute the set of command-type scopes a shell command belongs to. Returns an
 * empty array when the command cannot be safely reduced to a type (the caller
 * then remembers the exact command instead).
 */
export function shellGrantScopes(command: string): string[] {
  const trimmed = canonicalizeShellCommand(command);
  if (!trimmed) return [];
  if (isNonGrantableShellCommand(trimmed) || trimmed.includes("${")) return [];

  const scopes = new Set<string>();
  for (const segment of splitShellSegments(trimmed)) {
    const scope = segmentScope(segment);
    if (!scope) return [];
    scopes.add(scope);
  }
  return [...scopes];
}
