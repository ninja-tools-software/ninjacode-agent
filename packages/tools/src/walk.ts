import fs from "node:fs/promises";
import path from "node:path";
import { isSkippedDir } from "./ignore.js";

interface WalkOptions {
  /** Stop once this many files have been collected. */
  maxFiles?: number;
  /** Keep only these extensions (with the leading dot). All files when omitted. */
  extensions?: ReadonlySet<string>;
  /** Skip dot-files and dot-directories. */
  skipHidden?: boolean;
}

/**
 * Collect absolute file paths under `root`, skipping the directories in
 * `ignore.ts`. Unreadable directories are skipped rather than throwing: a
 * permission error deep in a tree should not fail the whole search.
 */
export async function collectFiles(root: string, options: WalkOptions = {}): Promise<string[]> {
  const { maxFiles = Infinity, extensions, skipHidden = false } = options;
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (found.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= maxFiles) return;
      if (isSkippedDir(entry.name)) continue;
      if (skipHidden && entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile() && (!extensions || extensions.has(path.extname(entry.name)))) {
        found.push(abs);
      }
    }
  }

  await walk(root);
  return found;
}
