import type { Message } from "@ninjacode/providers";

/**
 * Normalize tool-call chains so OpenAI/DeepSeek-compatible APIs accept the history.
 * - Drop orphan tool messages (no open assistant tool_calls block)
 * - Fill missing tool results with a synthetic placeholder
 * - Keep parallel tool results contiguous after their assistant
 */
export function normalizeToolHistory(history: Message[]): Message[] {
  const out: Message[] = [];

  for (let i = 0; i < history.length; i++) {
    const m = history[i]!;

    if (m.role === "assistant" && m.toolCalls?.length) {
      const tools: Message[] = [];
      let j = i + 1;
      while (j < history.length && history[j]?.role === "tool") {
        tools.push(history[j]!);
        j++;
      }
      const byId = new Map(
        tools.filter((t) => t.toolCallId).map((t) => [t.toolCallId!, t]),
      );
      const keptCalls = [...m.toolCalls];
      const results: Message[] = [];
      for (const tc of keptCalls) {
        const existing = byId.get(tc.id);
        results.push(
          existing ?? {
            role: "tool",
            toolCallId: tc.id,
            name: tc.name,
            content: "[tool result unavailable — recovered from incomplete session]",
          },
        );
      }
      out.push({ ...m, toolCalls: keptCalls });
      for (const r of results) out.push(r);
      i = j - 1;
      continue;
    }

    if (m.role === "tool") {
      // Orphans not attached to an assistant block above — drop
      continue;
    }

    out.push(m);
  }

  return out;
}

/**
 * Align a compaction cut index so we never split an assistant+tool block.
 */
export function alignCompactionStart(messages: Message[], start: number): number {
  if (start <= 0 || start >= messages.length) return start;
  if (messages[start]?.role !== "tool") return start;
  return alignToolCompactionStart(messages, start);
}

function alignToolCompactionStart(messages: Message[], start: number): number {
  let i = start;
  while (i > 0 && messages[i - 1]?.role === "tool") i--;
  const prior = messages[i - 1];
  if (i > 0 && prior?.role === "assistant" && prior.toolCalls?.length) {
    return i - 1;
  }
  while (start < messages.length && messages[start]?.role === "tool") start++;
  return start;
}

/** True if every tool message belongs to an open assistant tool_calls block. */
export function isValidToolChain(messages: Message[]): boolean {
  let open: Set<string> | null = null;
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      open = new Set(m.toolCalls.map((t) => t.id));
      continue;
    }
    if (m.role === "tool") {
      if (!open || !m.toolCallId || !open.has(m.toolCallId)) return false;
      open.delete(m.toolCallId);
      if (open.size === 0) open = null;
      continue;
    }
    if (open) return false;
  }
  return open == null;
}
