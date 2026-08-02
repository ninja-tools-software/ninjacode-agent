import type { Message } from "@ninjacode/providers";

/** Tools whose output is a slice of a file: re-reading one is re-reading the file. */
const READ_TOOLS = new Set(["read_file"]);

/** Overlapping reads of one path before the agent is told it is going in circles. */
const READ_CHURN_LIMIT = 4;

/** Lets the warning recognise its own past output, so each path is flagged once. */
const READ_CHURN_MARKER = "read the same file";

interface LineRange {
  start: number;
  end: number;
}

function rangeFromArgs(args: Record<string, unknown>): LineRange {
  const hasOffset = typeof args.offset === "number";
  const hasLimit = typeof args.limit === "number";
  if (!hasOffset && !hasLimit) return { start: 1, end: Number.POSITIVE_INFINITY };
  const start = hasOffset ? Math.max(1, args.offset as number) : 1;
  if (!hasLimit) return { start, end: Number.POSITIVE_INFINITY };
  return { start, end: start + (args.limit as number) - 1 };
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/**
 * Count reads per path that either start coverage or overlap already-seen ranges.
 * Disjoint pagination (each page extends without overlap) does not inflate the count.
 */
function countChurnByPath(history: Message[]): Map<string, number> {
  const counts = new Map<string, number>();
  const seen = new Map<string, LineRange[]>();

  for (const message of history) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls ?? []) {
      if (!READ_TOOLS.has(call.name)) continue;
      const target = call.arguments?.path;
      if (typeof target !== "string") continue;

      const range = rangeFromArgs(call.arguments);
      const prior = seen.get(target) ?? [];
      const overlaps = prior.length === 0 || prior.some((p) => rangesOverlap(p, range));
      if (overlaps) {
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
      seen.set(target, [...prior, range]);
    }
  }
  return counts;
}

function alreadyWarned(history: Message[], target: string): boolean {
  return history.some(
    (m) =>
      m.role === "user" &&
      typeof m.content === "string" &&
      m.content.includes(READ_CHURN_MARKER) &&
      m.content.includes(target),
  );
}

/**
 * Loop detection fingerprints a call with its arguments, so paging over one file
 * at shifting offsets reads as a series of new calls — the cheapest way there is
 * to burn a turn budget. Counting overlapping per-path ranges catches that churn;
 * disjoint pagination (continue with offset=N) is allowed; warning once per path
 * keeps the cached message suffix from churning.
 */
export function repeatedReadWarning(history: Message[]): string | undefined {
  const worst = [...countChurnByPath(history)]
    .filter(([target, count]) => count >= READ_CHURN_LIMIT && !alreadyWarned(history, target))
    .sort((a, b) => b[1] - a[1])[0];
  if (!worst) return undefined;

  const [target, count] = worst;
  return (
    `You have read the same file ${count} times: ${target}. Its contents are already in this ` +
    "conversation — scroll up rather than re-reading it. If a detail is genuinely missing, " +
    "grep for the exact symbol instead of paging through the file again."
  );
}
