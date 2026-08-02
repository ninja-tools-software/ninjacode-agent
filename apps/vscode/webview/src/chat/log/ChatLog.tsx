import { useState } from "react";
import type { LogItem, PlanState, SettingsState, TodoItem, VsCodeApi } from "../types.js";
import { LogEntry } from "./LogEntry.js";
import { useLogMarks } from "./useLogMarks.js";

interface ChatLogProps {
  log: LogItem[];
  busy: boolean;
  agentActive: boolean;
  activeSessionId?: string;
  plan: PlanState | null;
  todos: TodoItem[];
  settings: SettingsState | null;
  vscode: VsCodeApi;
}

function logEntryKey(item: LogItem, index: number): string | number {
  if (item.kind === "tool") {
    if (item.name === "write_plan") return `plan-${item.id ?? index}`;
    return item.id ?? index;
  }
  if ("requestId" in item && item.requestId) return item.requestId;
  return index;
}

export function ChatLog({
  log,
  busy,
  agentActive,
  activeSessionId,
  plan,
  todos,
  settings,
  vscode,
}: ChatLogProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const marks = useLogMarks(log, agentActive);

  return (
    <>
      {log.map((item, i) => (
        <LogEntry
          key={logEntryKey(item, i)}
          item={item}
          index={i}
          log={log}
          marks={marks}
          editingIndex={editingIndex}
          setEditingIndex={setEditingIndex}
          activeSessionId={activeSessionId}
          busy={busy}
          agentActive={agentActive}
          plan={plan}
          todos={todos}
          settings={settings}
          vscode={vscode}
        />
      ))}
    </>
  );
}
