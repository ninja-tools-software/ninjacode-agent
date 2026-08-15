import type { Message } from "@ninjacode/providers";

/**
 * Tools whose output can be obtained again by calling them: their old results
 * are the cheapest tokens to give up. Anything carrying information the agent
 * cannot reproduce — a user answer, a recorded hypothesis, a debug log capture —
 * is deliberately absent.
 */
const MASKABLE_TOOLS = new Set([
  "read_file",
  "list_dir",
  "grep",
  "glob",
  "run_shell",
  "search_codebase",
  "read_lints",
  "fetch_url",
  "web_search",
]);

/** Recent observations the model is still actively reasoning about. */
const KEEP_VERBATIM = 10;

/** Below this, masking would save nothing and lose a useful detail. */
const MIN_MASKABLE_CHARS = 400;

const PATH_ANNOTATION = /^\[path:[^\]]+\]\n/;

export function isMaskableObservation(message: Message): boolean {
  return message.role === "tool" && !!message.name && MASKABLE_TOOLS.has(message.name);
}

function maskedContent(message: Message): string {
  const annotation = message.content.match(PATH_ANNOTATION)?.[0] ?? "";
  return (
    `${annotation}[output masked to save context — ${message.name} produced ` +
    `${message.content.length} chars earlier in this session. Do not re-read this; ` +
    "the content is already in the conversation. Grep for a specific symbol if a detail is missing.]"
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
