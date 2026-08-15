import { createHash } from "node:crypto";
import type { Message } from "@ninjacode/providers";

/**
 * Deterministic local reads may be repeated. Shell and network observations are
 * deliberately absent: rerunning them may produce side effects or different data.
 */
const MASKABLE_TOOLS = new Set([
  "read_file",
  "list_dir",
  "grep",
  "glob",
  "search_codebase",
  "read_lints",
]);

/** Recent observations the model is still actively reasoning about. */
const KEEP_VERBATIM = 10;

/** Below this, masking would save nothing and lose a useful detail. */
const MIN_MASKABLE_CHARS = 400;

const PATH_ANNOTATION = /^\[path:[^\]]+\]\n/;
const ARTIFACT_REFERENCE = /artifact ([a-f0-9]{64})/;

export function isMaskableObservation(message: Message): boolean {
  return message.role === "tool" && !!message.name && MASKABLE_TOOLS.has(message.name);
}

function maskedContent(message: Message): string {
  const annotation = message.content.match(PATH_ANNOTATION)?.[0] ?? "";
  const artifactId = message.content.match(ARTIFACT_REFERENCE)?.[1];
  const sha256 = createHash("sha256").update(message.content).digest("hex").slice(0, 16);
  const recovery = artifactId
    ? `artifact ${artifactId}; use read_session_artifact`
    : "legacy observation has no recoverable archive";
  return (
    `${annotation}[output masked to save context — ${message.name} produced ` +
    `${message.content.length} chars earlier in this session. sha256=${sha256}. ${recovery}]`
  );
}

/**
 * Replace the body of old, re-runnable tool results with a stub. This is the
 * free tier of compaction: it costs nothing (no LLM call) and, unlike
 * summarization, does not distort what remains. Bodies are replaced rather than
 * deleted so assistant `tool_calls` chains stay valid.
 */
export function maskOldObservations(
  history: Message[],
  opts: { keepVerbatim?: number; minChars?: number } = {},
): Message[] {
  const keepVerbatim = opts.keepVerbatim ?? KEEP_VERBATIM;
  const minChars = opts.minChars ?? MIN_MASKABLE_CHARS;

  const maskableIndices = history.reduce<number[]>((acc, m, i) => {
    if (isMaskableObservation(m)) acc.push(i);
    return acc;
  }, []);
  if (maskableIndices.length <= keepVerbatim) return history;

  const toMask = new Set(
    maskableIndices
      .slice(0, maskableIndices.length - keepVerbatim)
      .filter((i) => history[i]!.content.length > minChars),
  );
  if (toMask.size === 0) return history;

  return history.map((m, i) => (toMask.has(i) ? { ...m, content: maskedContent(m) } : m));
}
