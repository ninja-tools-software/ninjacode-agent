/**
 * Shared SSE stream parsing for LLM provider adapters.
 */

function dataPayloadFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const data = trimmed.slice(5).trim();
  return data || undefined;
}

function flushBufferLines(buffer: string): { rest: string; payloads: string[] } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const payloads: string[] = [];
  for (const line of lines) {
    const data = dataPayloadFromLine(line);
    if (data) payloads.push(data);
  }
  return { rest, payloads };
}

export async function* sseDataLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const flushed = flushBufferLines(buffer);
      buffer = flushed.rest;
      for (const data of flushed.payloads) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseSseJson<T>(data: string): T | undefined {
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { _truncated: true, _raw: raw };
  }
}
