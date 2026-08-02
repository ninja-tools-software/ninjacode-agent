import { makeId } from "../format.js";
import type { LogItem, TodoItem, TodoStatus, ToolLogItem } from "../types.js";
import type { ToolCardStatus } from "../../../../src/protocol.js";

/** Coerce a hydrated (JSON, possibly from an older version) log entry into a `LogItem`. */
export function coerceLogItem(item: unknown): LogItem {
  if (!item || typeof item !== "object") return { kind: "status", text: "" };
  const raw = item as Record<string, unknown>;
  if (raw.kind === "tool") return normalizeToolItem(raw);
  return item as LogItem;
}

function normalizeToolItem(raw: Record<string, unknown>): ToolLogItem {
  const name = String(raw.name ?? "tool");
  return {
    kind: "tool",
    id: String(raw.id ?? makeId()),
    name,
    label: String(raw.label ?? name),
    target: raw.target ? String(raw.target) : undefined,
    status: (raw.status as ToolCardStatus) ?? "done",
    argsPreview: raw.argsPreview ? String(raw.argsPreview) : undefined,
    output: raw.output
      ? String(raw.output)
      : raw.text
        ? String(raw.text)
        : undefined,
    error: raw.error ? String(raw.error) : undefined,
    durationMs: typeof raw.durationMs === "number" ? raw.durationMs : undefined,
    lineRange: raw.lineRange ? String(raw.lineRange) : undefined,
  };
}

const TODO_OUTPUT_RE = /^\[(pending|in_progress|completed|cancelled)\] (\S+): (.*)$/;

function parseTodoLines(lines: string[]): TodoItem[] | null {
  const parsed: TodoItem[] = [];
  for (const line of lines) {
    const match = line.match(TODO_OUTPUT_RE);
    if (!match) return null;
    parsed.push({ status: match[1] as TodoStatus, id: match[2]!, content: match[3]! });
  }
  return parsed;
}

function parseTodosFromOutput(output: string): TodoItem[] | null {
  if (output === "(empty todo list)") return null;
  const lines = output.split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  return parseTodoLines(lines);
}

function parseTodosFromArgs(argsPreview: string): TodoItem[] | null {
  try {
    const args = JSON.parse(argsPreview) as { todos?: TodoItem[] };
    if (Array.isArray(args.todos) && args.todos.length > 0) return args.todos;
  } catch {
    /* ignore malformed preview */
  }
  return null;
}

/** Recover the todo list a `todo_write` call wrote, from its output or its arguments. */
export function parseTodosFromToolItem(item: ToolLogItem): TodoItem[] | null {
  if (item.output) {
    const fromOutput = parseTodosFromOutput(item.output);
    if (fromOutput) return fromOutput;
  }
  if (item.argsPreview) return parseTodosFromArgs(item.argsPreview);
  return null;
}
