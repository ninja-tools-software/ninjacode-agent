import { TodoItemsList } from "../panels/TodoList.js";
import type { ToolLogItem } from "../types.js";
import { ToolCard, ToolSummary } from "./ToolCard.js";
import { parseTodosFromToolItem } from "./toolLog.js";

/** `todo_write` renders its list instead of the raw tool output. */
export function TodoToolCard({ item, defaultOpen }: { item: ToolLogItem; defaultOpen?: boolean }) {
  const todos = parseTodosFromToolItem(item);
  if (!todos || todos.length === 0) return <ToolCard item={item} />;

  return (
    <details
      className={`tool-card todo-tool-card tool-${item.status} msg-enter`}
      open={item.status === "running" || Boolean(defaultOpen)}
    >
      <ToolSummary item={item} />
      <div className="tool-body todo-tool-body">
        <TodoItemsList todos={todos} />
      </div>
    </details>
  );
}
