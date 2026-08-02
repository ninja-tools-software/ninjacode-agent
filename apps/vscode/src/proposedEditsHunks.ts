import type { Hunk } from "./proposedEditsTypes.js";

type DiffOp = { type: "eq" | "del" | "add"; a?: string; b?: string };

function buildLcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  return dp;
}

function diffOps(a: string[], b: string[], dp: number[][]): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "eq", a: a[i - 1], b: b[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: "add", b: b[j - 1] });
      j--;
    } else {
      ops.push({ type: "del", a: a[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function opsToHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = [];
  let curIdx = 0;
  let afterIdx = 0;
  let cur: Hunk | null = null;
  for (const op of ops) {
    if (op.type === "eq") {
      if (cur) {
        hunks.push(cur);
        cur = null;
      }
      curIdx++;
      afterIdx++;
      continue;
    }
    cur ??= { id: "", currentStart: curIdx, currentLines: [], afterStart: afterIdx, afterLines: [] };
    if (op.type === "del") {
      cur.currentLines.push(op.a!);
      curIdx++;
    } else {
      cur.afterLines.push(op.b!);
      afterIdx++;
    }
  }
  if (cur) hunks.push(cur);
  hunks.forEach((h, k) => (h.id = `h${k}`));
  return hunks;
}

/** Bounded LCS-based line diff, grouped into contiguous add/remove hunks. */
export function computeHunks(current: string, after: string): Hunk[] {
  if (current === after) return [];
  const a = current.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 400_000) return [];
  return opsToHunks(diffOps(a, b, buildLcsTable(a, b)));
}
