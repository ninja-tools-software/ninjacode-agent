import type { ToolEventPayload, ToolLogFields } from "./protocol.js";

type L10nT = (message: string, ...args: Array<string | number | boolean>) => string;

/** Identity formatter until the host wires `vscode.l10n.t` (webview keeps English fallback). */
function defaultL10nT(message: string, ...args: Array<string | number | boolean>): string {
  return message.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
}

let l10nT: L10nT = defaultL10nT;

/** Wire host `vscode.l10n.t` so tool labels follow the UI locale. */
export function configureToolUiL10n(t: L10nT): void {
  l10nT = t;
}

/** Tools that render a dedicated interactive card — hide the generic tool JSON block. */
export function isInteractiveUserTool(name: string): boolean {
  return name === "ask_user" || name === "request_user_action";
}

/**
 * Information-gathering tools, folded into a single collapsible group in the chat log.
 * Explicit list rather than the core risk class: unknown tools (MCP, third-party) stay
 * visible on their own rather than silently disappearing into the group.
 */
const EXPLORATION_TOOLS = new Set([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "search",
  "search_codebase",
  "read_lints",
  "read_session_artifact",
  "read_debug_logs",
  "git_status",
  "git_diff",
  "git_log",
  "git_show",
  "fetch_url",
  "web_search",
  "delegate",
]);

export function isExplorationTool(name: string): boolean {
  return EXPLORATION_TOOLS.has(name);
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

export function formatArgsPreview(args?: Record<string, unknown>): string | undefined {
  if (!args || Object.keys(args).length === 0) return undefined;
  try {
    return truncateText(JSON.stringify(args, null, 2), 2000);
  } catch {
    return undefined;
  }
}

export function inferToolTarget(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  if (typeof args.path === "string") return args.path;
  if (typeof args.filename === "string") return args.filename;
  if (typeof args.pattern === "string") return args.pattern;
  if (typeof args.query === "string") return args.query;
  if (typeof args.command === "string") return truncateText(args.command, 80);
  if (typeof args.url === "string") return args.url;
  return undefined;
}

function formatRange(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}-${end}`;
}

/** Line range actually served by read_file (from tool meta). Preferred over args. */
export function formatReadRangeFromMeta(meta?: Record<string, unknown>): string | undefined {
  if (!meta) return undefined;
  const start = typeof meta.startLine === "number" ? Math.floor(meta.startLine) : null;
  const end = typeof meta.endLine === "number" ? Math.floor(meta.endLine) : null;
  if (start === null || end === null || start < 1 || end < start) return undefined;
  return formatRange(start, end);
}

/** Line range guessed from a read_file call's args (offset/limit). Undefined for full-file reads. */
export function formatReadRange(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const start = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
  if (typeof args.limit !== "number" || !Number.isFinite(args.limit)) return undefined;
  const limit = Math.floor(args.limit);
  if (limit <= 0) return undefined;
  return formatRange(start, start + limit - 1);
}

/** Line range changed between two file versions (on the "after" side). Undefined if identical. */
export function formatEditRange(before?: string, after?: string): string | undefined {
  if (typeof after !== "string") return undefined;
  const beforeStr = typeof before === "string" ? before : "";
  if (beforeStr === after) return undefined;
  const a = beforeStr.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const start = prefix + 1;
  const end = Math.max(start, b.length - suffix);
  return formatRange(start, end);
}

/** Compute a display line range for a file tool from its args and/or result meta. */
export function formatToolLineRange(
  name: string,
  args?: Record<string, unknown>,
  meta?: Record<string, unknown>,
): string | undefined {
  switch (name) {
    case "read_file":
      // Prefer the range the tool actually served (budget truncation, full-file reads).
      return formatReadRangeFromMeta(meta) ?? formatReadRange(args);
    case "write_file":
    case "edit_file": {
      if (!meta) return undefined;
      const before = typeof meta.before === "string" ? meta.before : undefined;
      const after = typeof meta.after === "string" ? meta.after : undefined;
      return formatEditRange(before, after);
    }
    case "apply_patch": {
      const changes = meta?.fileChanges;
      if (!changes || typeof changes !== "object") return undefined;
      const entries = Object.values(changes as Record<string, unknown>);
      if (entries.length !== 1) return undefined;
      const change = entries[0] as { before?: unknown; after?: unknown };
      const before = typeof change.before === "string" ? change.before : undefined;
      const after = typeof change.after === "string" ? change.after : undefined;
      return formatEditRange(before, after);
    }
    default:
      return undefined;
  }
}

const TOOL_LABELS: Record<string, (target?: string) => string> = {
  read_file: (target) => (target ? l10nT("Reading {0}", target) : l10nT("Reading file")),
  write_file: (target) => (target ? l10nT("Writing {0}", target) : l10nT("Writing file")),
  edit_file: (target) => (target ? l10nT("Editing {0}", target) : l10nT("Editing file")),
  apply_patch: (target) => (target ? l10nT("Editing {0}", target) : l10nT("Editing file")),
  search: (target) => (target ? l10nT("Searched {0}", target) : l10nT("Searching codebase")),
  grep: (target) => (target ? l10nT("Searched {0}", target) : l10nT("Searching codebase")),
  shell: (target) =>
    target ? l10nT("Ran {0}", truncateText(target, 80)) : l10nT("Ran shell command"),
  run_shell: (target) =>
    target ? l10nT("Ran {0}", truncateText(target, 80)) : l10nT("Ran shell command"),
  write_scratchpad: () => l10nT("Updated scratchpad"),
  write_plan: () => l10nT("Updated plan"),
  todo_write: () => l10nT("Updated todos"),
  ask_user: () => l10nT("Asked a question"),
  request_user_action: (target) =>
    target
      ? l10nT("Waiting for manual action: {0}", truncateText(target, 80))
      : l10nT("Waiting for manual action"),
  fetch_url: (target) => (target ? l10nT("Fetched {0}", target) : l10nT("Fetched URL")),
  list_dir: (target) => (target ? l10nT("Listed {0}", target) : l10nT("Listed directory")),
};

export function toolLabel(
  name: string,
  target?: string,
  _args?: Record<string, unknown>,
): string {
  const trimmed = target?.trim();
  const label = TOOL_LABELS[name];
  if (label) return label(trimmed);
  return trimmed ? l10nT("{0} ({1})", name, trimmed) : name;
}

export function toolPayloadToFields(payload: Partial<ToolEventPayload>): ToolLogFields {
  const name = payload.name ?? "tool";
  const args = payload.arguments;
  const target = payload.target ?? inferToolTarget(args);
  return {
    id: payload.id || crypto.randomUUID(),
    name,
    label: payload.label ?? toolLabel(name, target, args),
    target,
    status: payload.status ?? "done",
    argsPreview: payload.argsPreview ?? formatArgsPreview(args),
    output: payload.output || undefined,
    error: payload.error || undefined,
    durationMs: payload.durationMs,
    lineRange: payload.lineRange || undefined,
  };
}

export function mergeToolFields(
  prev: ToolLogFields,
  payload: Partial<ToolEventPayload>,
): ToolLogFields {
  const merged = toolPayloadToFields({
    ...prev,
    ...payload,
    id: prev.id,
    arguments: payload.arguments,
  });
  return {
    ...merged,
    label: payload.label ? merged.label : prev.label,
    argsPreview: merged.argsPreview ?? prev.argsPreview,
    target: merged.target ?? prev.target,
    lineRange: merged.lineRange ?? prev.lineRange,
  };
}
