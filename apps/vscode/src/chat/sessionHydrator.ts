import { toolOutputLimit, truncateToolOutput, type PersistedSession } from "@ninjacode/core";
import type { Message } from "@ninjacode/providers";
import type { ChangeItem, HydratePayload, UiLogItem } from "../protocol.js";
import type { ProposedEditsStore } from "../proposedEdits.js";
import type { SessionRuntime } from "../sessionRuntime.js";
import { formatArgsPreview, formatToolLineRange, inferToolTarget, isInteractiveUserTool, toolLabel } from "../toolUi.js";
import { stripAttachedContext } from "./contextRefs.js";

export function buildChangesPayload(edits: ProposedEditsStore): ChangeItem[] {
  return edits.listWithStats().map((e) => ({
    path: e.path,
    additions: e.additions,
    deletions: e.deletions,
    sensitive: e.sensitive,
    sessionId: e.sessionId,
  }));
}

function runtimeUiFields(
  runtime: SessionRuntime | undefined,
  pendingEdits: string[],
): Pick<
  HydratePayload,
  "log" | "todos" | "pendingEdits" | "hypotheses" | "debugLogCount" | "contextUsage" | "sessionUsage"
> {
  if (!runtime?.ui) {
    return {
      log: [],
      todos: [],
      pendingEdits,
      hypotheses: [],
      debugLogCount: 0,
      contextUsage: null,
      sessionUsage: null,
    };
  }
  const ui = runtime.ui;
  return {
    log: ui.log,
    todos: ui.todos,
    pendingEdits: ui.pendingEdits.length > 0 ? ui.pendingEdits : pendingEdits,
    hypotheses: ui.hypotheses,
    debugLogCount: ui.debugLogCount,
    contextUsage: ui.contextUsage,
    sessionUsage: ui.sessionUsage,
  };
}

/** Full UI snapshot for a session, used on `ready`, session switch and edit-and-resend. */
export function buildHydratePayload(args: {
  runtime?: SessionRuntime;
  activeSessionId?: string;
  sessions: HydratePayload["sessions"];
  pendingEdits: string[];
  showDragTip?: boolean;
  onboardingDismissed?: boolean;
}): HydratePayload {
  return {
    ...runtimeUiFields(args.runtime, args.pendingEdits),
    activeSessionId: args.activeSessionId,
    sessions: args.sessions,
    runState: args.runtime?.runState ?? "idle",
    queue: args.runtime?.queue ?? [],
    showDragTip: Boolean(args.showDragTip),
    onboardingDismissed: Boolean(args.onboardingDismissed),
  };
}

export function sessionHasPlan(saved: PersistedSession): boolean {
  if (saved.config.planId) return true;
  if (saved.config.mode === "plan") return true;
  for (const m of saved.history) {
    if (m.role === "tool" && (m.name === "write_plan" || m.name === "write_scratchpad")) return true;
    if (
      m.role === "assistant" &&
      m.toolCalls?.some((tc) => tc.name === "write_plan" || tc.name === "write_scratchpad")
    )
      return true;
  }
  return false;
}

function appendUserMessage(log: UiLogItem[], m: Message): void {
  const text = m.content ?? "";
  if (text.startsWith("[Compacted earlier conversation]")) {
    log.push({ kind: "status", text: "⋯ earlier conversation compacted" });
    return;
  }
  log.push({ kind: "user", text: stripAttachedContext(text) });
}

function appendAssistantMessage(
  log: UiLogItem[],
  openTools: Array<{ name: string; id: string }>,
  toolIdx: { value: number },
  m: Message,
): void {
  if (m.content?.trim()) log.push({ kind: "assistant", text: m.content });
  for (const tc of m.toolCalls ?? []) {
    if (isInteractiveUserTool(tc.name)) continue;
    const args = tc.arguments as Record<string, unknown>;
    const target = inferToolTarget(args);
    const id = `hist-${toolIdx.value++}`;
    openTools.push({ name: tc.name, id });
    log.push({
      kind: "tool",
      id,
      name: tc.name,
      label: toolLabel(tc.name, target, args),
      target,
      status: "done",
      argsPreview: formatArgsPreview(args),
      lineRange: formatToolLineRange(tc.name, args),
    });
  }
}

/** Prefixes the tool pipeline writes on failure — not the word "error" in a file. */
const TOOL_FAILURE_PREFIXES = [
  "Tool error [",
  "✗",
  "Blocked by PreToolUse hook:",
  "Tool call aborted by user.",
  "Aborted by user before this tool call ran.",
  "Run stopped before this tool call ran.",
  "User denied this tool call.",
  "Approval wait aborted by user.",
  "Approval wait aborted.",
  "Denied:",
  "Approval required for ",
  "Unknown tool:",
] as const;

/** True when persisted tool output is a failure, not a successful payload that mentions "error". */
export function toolOutputLooksLikeError(output: string): boolean {
  const text = output.trimStart();
  if (TOOL_FAILURE_PREFIXES.some((prefix) => text.startsWith(prefix))) return true;
  return (
    /^Tool \S+ circuit-open /.test(text) || /^Tool call \S+ had truncated JSON arguments/.test(text)
  );
}

function appendToolResult(
  log: UiLogItem[],
  openTools: Array<{ name: string; id: string }>,
  toolIdx: { value: number },
  m: Message,
): void {
  const name = m.name ?? "tool";
  if (isInteractiveUserTool(name)) return;
  const output = truncateToolOutput(m.content ?? "", toolOutputLimit(name));
  const matchedIdx = openTools.findIndex((t) => t.name === name);
  const matched = matchedIdx >= 0 ? openTools.splice(matchedIdx, 1)[0] : undefined;
  const id = matched?.id ?? `hist-${toolIdx.value++}`;
  const existingIdx = log.findIndex((item) => item.kind === "tool" && item.id === id);
  const item = existingIdx >= 0 ? log[existingIdx] : undefined;
  const status = toolOutputLooksLikeError(output) ? "error" : "done";
  if (item?.kind === "tool") {
    log[existingIdx] = { ...item, output, status };
    return;
  }
  log.push({ kind: "tool", id, name, label: toolLabel(name), status, output });
}

/** Rebuild the chat log from persisted history when a session is re-opened. */
export function historyToUiLog(history: Message[]): UiLogItem[] {
  const log: UiLogItem[] = [];
  const toolIdx = { value: 0 };
  const openTools: Array<{ name: string; id: string }> = [];

  for (const m of history) {
    if (m.role === "user") appendUserMessage(log, m);
    else if (m.role === "assistant") appendAssistantMessage(log, openTools, toolIdx, m);
    else if (m.role === "tool") appendToolResult(log, openTools, toolIdx, m);
  }
  return log;
}
