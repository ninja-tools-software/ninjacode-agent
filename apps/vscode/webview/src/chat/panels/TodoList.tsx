import { useState } from "react";
import { CheckIcon, ChevronDownIcon, CloseIcon, LoaderIcon, StopIcon, type IconSize } from "../../icons.js";
import { t } from "../../i18n.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import type { TodoItem, TodoStatus } from "../types.js";

function TodoStatusIcon({ status, size = 14 }: { status: TodoStatus; size?: IconSize }) {
  switch (status) {
    case "completed":
      return <CheckIcon size={size} className="todo-icon todo-icon-completed" />;
    case "cancelled":
      return <CloseIcon size={size} className="todo-icon todo-icon-cancelled" />;
    case "in_progress":
      return <LoaderIcon size={size} className="todo-icon todo-icon-progress todo-spin" />;
    case "pending":
    default:
      return (
        <svg
          className="todo-icon todo-icon-pending"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

export function TodoItemsList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="todo-items">
      {todos.map((todo) => (
        <li key={todo.id} className={`todo status-${todo.status}`}>
          <span className="todo-mark" aria-hidden="true">
            <TodoStatusIcon status={todo.status} />
          </span>
          <span className="todo-content">{todo.content}</span>
        </li>
      ))}
    </ul>
  );
}

/** Shared chevron used by collapsible panel headers (Changes, Tasks). */
export function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <span className={animCls("collapse-chevron", collapsed && "collapsed")} aria-hidden="true">
      <ChevronDownIcon size={14} />
    </span>
  );
}

export function countDone(todos: TodoItem[]): number {
  return todos.filter((t) => t.status === "completed" || t.status === "cancelled").length;
}

export function TodoList({
  todos,
  closing,
  pinned,
  busy,
  onStop,
}: {
  todos: TodoItem[];
  closing?: boolean;
  pinned?: boolean;
  busy?: boolean;
  onStop?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(Boolean(pinned));
  const showStop = pinned && busy && onStop;
  return (
    <div className={animCls("todos panel-enter", pinned && "todos-pinned", closing && "anim-closing")}>
      <div className="dock-panel-header todos-header">
        <button
          type="button"
          className="dock-panel-toggle collapsible-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="collapsible-title">
            <CollapseChevron collapsed={collapsed} />
            <strong>{t("Tasks")}</strong>
          </span>
        </button>
        <div className="dock-panel-actions todos-header-actions">
          <span className="log-count">
            {countDone(todos)}/{todos.length}
          </span>
          {showStop && (
            <button
              type="button"
              className="todos-stop"
              data-tooltip={t("Stop the current agent run (Esc)")}
              aria-label={t("Stop agent")}
              onClick={onStop}
            >
              <StopIcon />
              <span>{t("Stop")}</span>
            </button>
          )}
        </div>
      </div>
      {!collapsed && <TodoItemsList todos={todos} />}
    </div>
  );
}
