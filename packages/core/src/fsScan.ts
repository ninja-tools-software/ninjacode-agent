import fs from "node:fs/promises";
import path from "node:path";

/** Directories we never descend into when walking a workspace for rule/skill files. */
const DEFAULT_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  ".ninjacode",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
]);

/**
 * Recursively walk `root` looking for files whose basename is in `filenames`,
 * bounded by depth/result-count so this stays cheap on large repos.
 */
export async function walkForFilenames(
  root: string,
  filenames: string[],
  options?: { maxDepth?: number; maxResults?: number; excludedDirs?: Set<string> },
): Promise<string[]> {
  const maxDepth = options?.maxDepth ?? 6;
  const maxResults = options?.maxResults ?? 40;
  const excluded = options?.excludedDirs ?? DEFAULT_EXCLUDED_DIRS;
  const wanted = new Set(filenames);
  const results: string[] = [];

  async function visit(dir: string, depth: number): Promise<void> {
    if (results.length >= maxResults || depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".cursor") {
        // Skip dotdirs/files except the well-known convention dirs handled elsewhere.
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        await visit(path.join(dir, entry.name), depth + 1);
      } else if (wanted.has(entry.name)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  await visit(root, 0);
  return results;
}

/** List files directly inside `dir` (non-recursive) whose name matches `suffixes`. */
export async function listFilesWithSuffix(dir: string, suffixes: string[]): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && suffixes.some((s) => e.name.endsWith(s)))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/** List immediate subdirectories of `dir`. */
export async function listSubdirs(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
}

export async function readFileSafe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}
