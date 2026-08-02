import type { Message } from "@ninjacode/providers";

/** Rough token estimate (chars / 4) for compaction thresholds. */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
