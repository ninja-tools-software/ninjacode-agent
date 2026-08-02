/**
 * Directories no tool ever walks into: dependency trees, VCS internals, build
 * output and caches. Single source of truth — every tool that traverses the
 * workspace or shells out to a search engine derives its exclusions from here.
 *
 * Traversal only: passing one of these as an explicit path still works, so a
 * project whose sources live in `out/` stays reachable.
 */
const SKIPPED_DIR_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".turbo",
  ".next",
  "coverage",
  ".ninjacode",
  ".vite",
] as const;

const SKIPPED_DIRS: ReadonlySet<string> = new Set(SKIPPED_DIR_NAMES);

export function isSkippedDir(name: string): boolean {
  return SKIPPED_DIRS.has(name);
}

/** The same exclusions as glob patterns, for `fast-glob`. */
export const SKIPPED_DIR_GLOBS: readonly string[] = SKIPPED_DIR_NAMES.map((d) => `**/${d}/**`);

/** The same exclusions as ripgrep arguments. */
export function ripgrepIgnoreArgs(): string[] {
  return SKIPPED_DIR_GLOBS.flatMap((glob) => ["--glob", `!${glob}`]);
}
