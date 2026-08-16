/**
 * Shared Anthropic prompt-caching helpers.
 *
 * The Anthropic Messages API caches everything up to a `cache_control` marker.
 * For a stable agent prefix we place ephemeral breakpoints on the system block,
 * the last tool definition, and the compacted-summary boundary. Reused by
 * both the direct provider (`anthropic.ts`) and the gateway proxy (`backend/`).
 */

const EPHEMERAL = { type: "ephemeral" as const };
const COMPACTION_MARKER = "[Compacted earlier conversation]";

/** A mutable Anthropic Messages request payload we can annotate in place. */
export interface AnthropicCacheablePayload {
  system?: unknown;
  tools?: unknown;
  messages?: unknown;
}

function markCompactionSummary(messages: Array<Record<string, unknown>>): void {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    if (typeof message.content === "string") {
      if (!message.content.includes(COMPACTION_MARKER)) continue;
      message.content = [{ type: "text", text: message.content, cache_control: EPHEMERAL }];
      return;
    }
    if (!Array.isArray(message.content)) continue;
    const blocks = message.content as Array<Record<string, unknown>>;
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]!;
      if (typeof block.text !== "string" || !block.text.includes(COMPACTION_MARKER)) continue;
      block.cache_control = EPHEMERAL;
      return;
    }
  }
}

/**
 * Place ephemeral cache breakpoints on stable boundaries (system, last tool,
 * latest compacted summary) of an Anthropic Messages payload. Volatile tail
 * messages are deliberately never marked. Mutates and returns the
 * payload. No-op on empty sections. Stays within Anthropic's 4-breakpoint limit.
 */
export function applyAnthropicCacheBreakpoints<T extends AnthropicCacheablePayload>(body: T): T {
  if (typeof body.system === "string") {
    if (body.system.length > 0) {
      body.system = [{ type: "text", text: body.system, cache_control: EPHEMERAL }];
    }
  } else if (Array.isArray(body.system) && body.system.length > 0) {
    const blocks = body.system as Array<Record<string, unknown>>;
    blocks[blocks.length - 1]!.cache_control = EPHEMERAL;
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const tools = body.tools as Array<Record<string, unknown>>;
    tools[tools.length - 1]!.cache_control = EPHEMERAL;
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    markCompactionSummary(body.messages as Array<Record<string, unknown>>);
  }

  return body;
}
