import { useState } from "react";
import { ChatMarkdown } from "../../ChatMarkdown.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import type { PlanState, SettingsState, TodoItem, VsCodeApi } from "../types.js";
import { ExecutePlanButton } from "./ExecutePlanButton.js";
import { stripLeadingH1 } from "./planCardPreview.js";
import { TodoItemsList, countDone } from "./TodoList.js";

/** Longest plan preview rendered inline; the full plan opens in the Plan tab. */
const PREVIEW_CHARS = 1200;

function PlanCardHeader({ plan }: { plan: PlanState }) {
  return (
    <div className="plan-card-header">
      <div>
        <strong>{plan.title || "Plan"}</strong>
        <span className="muted plan-path" data-tooltip={plan.path}>
          {plan.path}
        </span>
      </div>
    </div>
  );
}

function PlanCardPreview({ content }: { content: string }) {
  const body = stripLeadingH1(content);
  const truncated = body.length > PREVIEW_CHARS;
  const [expanded, setExpanded] = useState(false);
  const preview = !truncated || expanded ? body : `${body.slice(0, PREVIEW_CHARS)}…`;

  return (
    <>
      <div className={`plan-preview md${expanded ? " plan-preview-expanded" : ""}`}>
        <ChatMarkdown>{preview}</ChatMarkdown>
      </div>
      {truncated && (
        <button type="button" className="plan-show-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function PlanCardTodos({ todos }: { todos: TodoItem[] }) {
  if (todos.length === 0) return null;
  return (
    <div className="plan-todos">
      <div className="todos-header">
        <strong>Tasks</strong>
        <span className="log-count">
          {countDone(todos)}/{todos.length}
        </span>
      </div>
      <TodoItemsList todos={todos} />
    </div>
  );
}

export function PlanCard({
  plan,
  todos,
  busy,
  settings,
  vscode,
  closing,
  showTodos = true,
}: {
  plan: PlanState;
  todos: TodoItem[];
  busy: boolean;
  settings: SettingsState | null;
  vscode: VsCodeApi;
  closing?: boolean;
  /** When false, tasks render only via the separate todo card in the log. */
  showTodos?: boolean;
}) {
  return (
    <div className={animCls("plan-card panel-enter", closing && "anim-closing")}>
      <PlanCardHeader plan={plan} />
      <PlanCardPreview content={plan.content} />
      {showTodos && <PlanCardTodos todos={todos} />}
      <div className="plan-card-footer">
        <button
          type="button"
          className="btn plan-view-btn"
          data-tooltip="Open the full plan"
          onClick={() => vscode.postMessage({ type: "open_plan", planId: plan.id })}
        >
          View plan
        </button>
        <ExecutePlanButton busy={busy} settings={settings} vscode={vscode} />
      </div>
    </div>
  );
}

/** One-line marker for earlier plan revisions in the same conversation. */
export function PlanCompactRow({
  title,
  planId,
  vscode,
}: {
  title: string;
  planId?: string;
  vscode: VsCodeApi;
}) {
  return (
    <button
      type="button"
      className="plan-compact-row msg-enter"
      data-tooltip="Open this plan revision"
      onClick={() => vscode.postMessage({ type: "open_plan", ...(planId ? { planId } : {}) })}
    >
      <span className="plan-compact-label">Plan updated</span>
      <span className="plan-compact-title">{title || "Plan"}</span>
    </button>
  );
}
