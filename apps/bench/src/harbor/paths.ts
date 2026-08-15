import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `apps/bench` — works from `src/harbor` and `dist/harbor`. */
export function benchRoot(): string {
  return path.resolve(here, "..", "..");
}

export function repoRoot(): string {
  return path.resolve(benchRoot(), "..", "..");
}

export function agentImportPath(): string {
  return path.join(benchRoot(), "harbor", "ninjacode_agent.py");
}

export function cliBundlePath(): string {
  return path.join(repoRoot(), "apps", "cli", "dist", "ninjacode.cjs");
}

export const DEFAULT_DATASET = "terminal-bench/terminal-bench-2-1";
