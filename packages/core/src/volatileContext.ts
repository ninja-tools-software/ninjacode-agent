import type { Message } from "@ninjacode/providers";

/** Per-section cap: durable notes are useful, a whole file pasted in is not. */
const SECTION_MAX_CHARS = 4_000;

export interface VolatileContext {
  scratchpad: string;
  plan: string;
}

function truncateSection(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SECTION_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SECTION_MAX_CHARS)}\n…[truncated]`;
}

/**
 * Scratchpad and plan change while the agent runs, so they cannot live in the
 * system prompt: rewriting it mid-session invalidates the whole cached prefix
 * (tools + system + history). Appending them to the tail of the history keeps
 * the prefix append-only, which is what the provider cache matches on.
 *
 * Returns null when there is nothing to say — an empty scratchpad costs no tokens.
 */
export function buildVolatileContextMessage(context: VolatileContext): Message | null {
  const scratchpad = truncateSection(context.scratchpad);
  const plan = truncateSection(context.plan);
  if (!scratchpad && !plan) return null;

  const sections = [
    "[Workspace state] This supersedes any earlier scratchpad or plan snapshot in this conversation.",
    scratchpad ? `\nCurrent scratchpad:\n${scratchpad}` : "",
    plan ? `\nCurrent plan:\n${plan}` : "",
  ].filter(Boolean);

  return { role: "user", content: sections.join("\n") };
}

/** Build only changed volatile sections; explicit clears prevent stale model state. */
export function buildVolatileContextDelta(
  previous: VolatileContext,
  next: VolatileContext,
): Message | null {
  if (!volatileContextChanged(previous, next)) return null;
  const scratchpad = truncateSection(next.scratchpad);
  const plan = truncateSection(next.plan);
  const sections = [
    "[Workspace state delta] Apply these changes to the latest workspace state.",
    previous.scratchpad !== next.scratchpad
      ? `\nCurrent scratchpad:\n${scratchpad || "(cleared)"}`
      : "",
    previous.plan !== next.plan ? `\nCurrent plan:\n${plan || "(cleared)"}` : "",
  ].filter(Boolean);
  return { role: "user", content: sections.join("\n") };
}

/** True when the snapshot differs from what the model has already been told. */
export function volatileContextChanged(previous: VolatileContext, next: VolatileContext): boolean {
  return previous.scratchpad !== next.scratchpad || previous.plan !== next.plan;
}

/**
 * Older snapshots are pure noise once a newer one exists: shrink them to a stub
 * rather than dropping them, so the message sequence stays untouched (and with
 * it the cached prefix up to the previous snapshot).
 */
export function stubSupersededVolatileContext(history: Message[]): Message[] {
  const lastIndex = history.reduce(
    (found, m, i) => (isVolatileContextMessage(m) ? i : found),
    -1,
  );
  if (lastIndex < 0) return history;

  return history.map((m, i) =>
    isVolatileContextMessage(m) && i !== lastIndex
      ? { ...m, content: "[Workspace state] Superseded by a later snapshot." }
      : m,
  );
}

export function isVolatileContextMessage(message: Message): boolean {
  return (
    message.role === "user" &&
    (message.content.startsWith("[Workspace state]") ||
      message.content.startsWith("[Workspace state delta]"))
  );
}
