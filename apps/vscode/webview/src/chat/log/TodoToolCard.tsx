import { useState } from "react";
import { TodoItemsList } from "../panels/TodoList.js";
import type { ToolLogItem } from "../types.js";
import { ToolCard, ToolSummary } from "./ToolCard.js";
import { parseTodosFromToolItem } from "./toolLog.js";

/** `todo_write` renders its list instead of the raw tool output. */
export function TodoToolCard({ item, defaultOpen }: { item: ToolLogItem; defaultOpen?: boolean }) {
  const todos = parseTodosFromToolItem(item);
  const [override, setOverride] = useState<boolean | null>(null);
  if (!todos || todos.length === 0) return <ToolCard item={item} />;

  const open = override ?? (item.status === "running" || Boolean(defaultOpen));
  return (
    <div className={`tool-card todo-tool-card tool-${item.status} msg-enter${open ? " is-open" : ""}`}>
      <ToolSummary item={item} open={open} onToggle={() => setOverride(!open)} />
      {open && (
        <div className="tool-body todo-tool-body">
          <TodoItemsList todos={todos} />
        </div>
      )}
    </div>
  );
}
