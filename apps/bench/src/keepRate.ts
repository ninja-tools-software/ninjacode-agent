import type { TaskResult } from "./types.js";

/** Local keep-rate: share of trials whose workspace edits would be kept (passed verify). */
export function computeKeepRate(results: TaskResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((result) => result.passed).length / results.length;
}
