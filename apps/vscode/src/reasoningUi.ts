/** Append a streamed reasoning token, breaking lines on paragraphs or new sentences. */
export function appendReasoningDelta(current: string, delta: string): string {
  if (!delta) return current;

  if (delta.includes("\n")) {
    return current + delta;
  }

  const trimmed = current.trimEnd();
  if (trimmed.length > 0 && /[.!?]["']?\s*$/.test(trimmed)) {
    const rest = delta.trimStart();
    if (rest.length > 0 && /^[A-ZÀ-ÖØ-Þ(["']/.test(rest)) {
      return `${current.trimEnd()}\n${rest}`;
    }
  }

  return current + delta;
}

export function reasoningLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

type ReasoningLogItem = { kind: string; text?: string };

/** Append a reasoning token to a UI log, replacing a trailing "Thinking…" status when present. */
export function appendReasoningToLog<T extends ReasoningLogItem>(
  log: T[],
  delta: string,
): T[] {
  if (!delta) return log;

  let copy = [...log];
  const last = copy[copy.length - 1];
  if (last?.kind === "status" && last.text === "Thinking…") {
    copy = copy.slice(0, -1);
  }

  const prev = copy[copy.length - 1];
  if (prev?.kind === "reasoning" && typeof prev.text === "string") {
    copy[copy.length - 1] = {
      ...prev,
      text: appendReasoningDelta(prev.text, delta),
    };
  } else {
    copy.push({ kind: "reasoning", text: delta } as T);
  }
  return copy;
}

/** Merge adjacent reasoning blocks into one. */
export function normalizeReasoningLog<T extends ReasoningLogItem>(log: T[]): T[] {
  const out: T[] = [];

  for (const item of log) {
    if (item.kind === "reasoning" && typeof item.text === "string") {
      const prev = out[out.length - 1];
      if (prev?.kind === "reasoning" && typeof prev.text === "string") {
        out[out.length - 1] = { ...prev, text: appendReasoningDelta(prev.text, item.text) };
        continue;
      }
    }

    out.push(item);
  }

  return out;
}
