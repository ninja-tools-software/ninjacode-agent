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

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Metacharacters that make a token untrustworthy as a program name. */
const UNSAFE_TOKEN = /[$`()<>*?{}[\]!~]/;

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' || first === "'") && first === last) return token.slice(1, -1);
  }
  return token;
}

function basename(program: string): string {
  const slash = program.lastIndexOf("/");
  return slash === -1 ? program : program.slice(slash + 1);
}

/**
 * Split a command line into the individual command segments separated by
 * pipes, sequencing and boolean operators. Each segment is a candidate
 * invocation of its own program.
 */
export function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:\|\||&&|;|\||&|\n)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Program name plus remaining arguments for one segment, with leading
 * `VAR=value` assignments skipped. Null when no program can be read.
 */
export function segmentProgram(segment: string): { program: string; args: string[] } | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i]!)) i++;
  const rawProgram = tokens[i];
  if (!rawProgram) return null;
  const program = basename(stripQuotes(rawProgram));
  if (!program) return null;
  return { program, args: tokens.slice(i + 1).map(stripQuotes) };
}

/** Scope for a single command segment (no pipes/operators), or null if unparseable. */
function segmentScope(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && ASSIGNMENT.test(tokens[i]!)) i++;
  const rawProgram = tokens[i];
  if (!rawProgram) return null;
  if (UNSAFE_TOKEN.test(rawProgram)) return null;

  const program = basename(stripQuotes(rawProgram));
  if (!program) return null;

  if (SUBCOMMAND_PROGRAMS.has(program)) {
    const next = tokens[i + 1];
    if (next && !next.startsWith("-") && !ASSIGNMENT.test(next) && !UNSAFE_TOKEN.test(next)) {
      return `${program} ${stripQuotes(next)}`;
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
  const trimmed = command.trim();
  if (!trimmed) return [];
  // Command substitution / parameter expansion make the effective program(s)
  // impossible to know statically — never coarsen these into a type grant.
  if (trimmed.includes("$(") || trimmed.includes("${") || trimmed.includes("`")) return [];

  const scopes = new Set<string>();
  for (const segment of splitShellSegments(trimmed)) {
    const scope = segmentScope(segment);
    if (!scope) return [];
    scopes.add(scope);
  }
  return [...scopes];
}
