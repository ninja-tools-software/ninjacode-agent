import { createHash } from "node:crypto";
import type { CompletionRequest } from "./types.js";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

/** Hash the byte-stable cache prefix: system (including rules/profile) and tools. */
export function promptCacheKey(model: string, request: CompletionRequest): string {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content);
  const prefix = JSON.stringify(stableValue({ system, tools: request.tools ?? [] }));
  const hash = createHash("sha256").update(prefix).digest("hex").slice(0, 32);
  return `ninjacode:${model}:${hash}`;
}
