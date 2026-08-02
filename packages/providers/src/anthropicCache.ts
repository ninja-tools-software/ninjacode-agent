/**
 * Shared Anthropic prompt-caching helpers.
 *
 * The Anthropic Messages API caches everything up to a `cache_control` marker.
 * For a stable agent prefix we place ephemeral breakpoints on the system block,
 * the last tool definition, and the last block of the last message. Reused by
 * both the direct provider (`anthropic.ts`) and the gateway proxy (`backend/`).
 */

const EPHEMERAL = { type: "ephemeral" as const };

/** A mutable Anthropic Messages request payload we can annotate in place. */
export interface AnthropicCacheablePayload {
  system?: unknown;
  tools?: unknown;
  messages?: unknown;
}

function markLastBlock(content: unknown): unknown {
  if (typeof content === "string") {
    if (content.length === 0) return content;
    return [{ type: "text", text: content, cache_control: EPHEMERAL }];
  }
  if (Array.isArray(content) && content.length > 0) {
    const blocks = content as Array<Record<string, unknown>>;
    blocks[blocks.length - 1]!.cache_control = EPHEMERAL;
  }
  return content;
}

/**
 * Place ephemeral cache breakpoints on the stable prefix (system, last tool,
 * last message block) of an Anthropic Messages payload. Mutates and returns the
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
    const msgs = body.messages as Array<Record<string, unknown>>;
    const last = msgs[msgs.length - 1]!;
    last.content = markLastBlock(last.content);
  }

  return body;
}
