import { createHash } from "node:crypto";
import type { Message } from "@ninjacode/providers";

/**
 * Deterministic local reads may be repeated. Ordinary shell output stays
 * verbatim (rerunning it may have side effects); large data dumps are masked
 * once archived because they pollute the context the same way a paged PPM does.
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
  if (message.role !== "tool" || !message.name) return false;
  if (MASKABLE_TOOLS.has(message.name)) return true;
  return message.name === "run_shell" && looksLikeDataDumpContent(message.content);
}

function looksLikeDataDumpContent(content: string): boolean {
  if (content.length < 400) return false;
  if (content.includes("\0")) return true;
  const head = content.slice(0, 512);
  if (/^P[1-6](?:\s|$)/u.test(head)) return true;
  const sample = content.slice(0, 4_000);
  const numbers = sample.match(/\d+/g)?.length ?? 0;
  const lines = Math.max(sample.split("\n").length, 1);
  return numbers > 200 && sample.length / lines > 40;
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

export function hasRecoverableArtifact(message: Message): boolean {
  return ARTIFACT_REFERENCE.test(message.content);
}

/**
 * Replace old tool results only when their exact bytes are already archived.
 * Without a recovery artifact the observation remains verbatim; later
 * compaction may reduce it, but we never create an irreversible stub.
 */
export function maskOldObservations(
  history: Message[],
  opts: { keepVerbatim?: number; minChars?: number } = {},
): Message[] {
  const keepVerbatim = opts.keepVerbatim ?? KEEP_VERBATIM;
  const minChars = opts.minChars ?? MIN_MASKABLE_CHARS;

  const maskableIndices = history.reduce<number[]>((acc, m, i) => {
    if (isMaskableObservation(m) && hasRecoverableArtifact(m)) acc.push(i);
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
