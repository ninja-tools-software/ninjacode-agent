import { useState } from "react";
import { reasoningLines } from "../../../../src/reasoningUi.js";
import { ChatMarkdown } from "../../ChatMarkdown.js";
import { CopyIcon } from "../../icons.js";
import { CollapseChevron } from "../panels/TodoList.js";
import { PlanCard, PlanCompactRow } from "../panels/PlanCard.js";
import { t } from "../../i18n.js";
import type { LogItem, PlanState, SettingsState, TodoItem, VsCodeApi } from "../types.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { GatewayErrorCard } from "./GatewayErrorCard.js";
import { QuestionCard } from "./QuestionCard.js";
import { ToolCard } from "./ToolCard.js";
import { TodoToolCard } from "./TodoToolCard.js";
import { UserActionCard } from "./UserActionCard.js";
import { UserMessage, UserMessageEditor } from "./UserMessage.jsx";
import type { LogMarks } from "./useLogMarks.js";

const HIDDEN_TOOLS = new Set(["ask_user", "request_user_action"]);

function AssistantMessage({
  text,
  isFinal,
  deferMermaid,
  vscode,
}: {
  text: string;
  isFinal: boolean;
  deferMermaid: boolean;
  vscode: VsCodeApi;
}) {
  return (
    <div className="msg assistant user-hoverable msg-enter">
      <div className="md">
        <ChatMarkdown
          deferMermaid={deferMermaid}
          onMermaidOpen={(source) => vscode.postMessage({ type: "open_mermaid", source })}
        >
          {text || "…"}
        </ChatMarkdown>
      </div>
      {text && (
        <div className="msg-hover-actions">
          <button
            className="icon-btn icon-btn--sm"
            data-tooltip={isFinal ? t("Copy final response") : t("Copy response")}
            aria-label={t("Copy response")}
            onClick={() => vscode.postMessage({ type: "copy_to_clipboard", text })}
          >
            <CopyIcon size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function ReasoningMessage({ text, isLive }: { text: string; isLive: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const collapsed = override ?? !isLive;
  const lines = reasoningLines(text);
  return (
    <div className={`msg reasoning msg-enter${isLive ? " reasoning-live" : ""}`}>
      <button
        type="button"
        className="reasoning-header collapsible-header"
        aria-expanded={!collapsed}
        onClick={() => setOverride(!collapsed ? true : false)}
      >
        <CollapseChevron collapsed={collapsed} />
        {isLive && <span className="status-live-dot" aria-hidden="true" />}
        <span className="reasoning-label">{t("Reasoning")}</span>
      </button>
      {!collapsed && (
        <div className="reasoning-body">
          {lines.map((line, li) => (
            <p key={li} className="reasoning-line">
              {line}
              {isLive && li === lines.length - 1 && <span className="reasoning-cursor" aria-hidden="true" />}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function userOrdinal(log: LogItem[], index: number): number {
  return log.slice(0, index + 1).filter((x) => x.kind === "user").length - 1;
}

function isFinalAssistant(log: LogItem[], index: number): boolean {
  return index === log.length - 1 || !log.slice(index + 1).some((x) => x.kind === "user");
}

function UserLogEntry({
  item,
  index,
  log,
  editingIndex,
  setEditingIndex,
  activeSessionId,
  busy,
  vscode,
}: {
  item: Extract<LogItem, { kind: "user" }>;
  index: number;
  log: LogItem[];
  editingIndex: number | null;
  setEditingIndex: (i: number | null) => void;
  activeSessionId?: string;
  busy: boolean;
  vscode: VsCodeApi;
}) {
  const ordinal = userOrdinal(log, index);
  if (editingIndex === index) {
    return (
      <UserMessageEditor
        initialText={item.text}
        onCancel={() => setEditingIndex(null)}
        onSave={(text) => {
          if (activeSessionId) {
            vscode.postMessage({
              type: "edit_and_resend",
              sessionId: activeSessionId,
              messageIndex: ordinal,
              text,
            });
          }
          setEditingIndex(null);
        }}
      />
    );
  }
  return (
    <UserMessage
      text={item.text}
      refs={item.refs}
      canEditFork={Boolean(activeSessionId) && !busy}
      onEdit={() => setEditingIndex(index)}
      onFork={() =>
        activeSessionId &&
        vscode.postMessage({
          type: "fork_session",
          sessionId: activeSessionId,
          messageIndex: ordinal,
        })
      }
      vscode={vscode}
    />
  );
}

function PlanBlockEntry({
  log,
  marks,
  plan,
  todos,
  busy,
  settings,
  agentActive,
  vscode,
}: {
  log: LogItem[];
  marks: LogMarks;
  plan: PlanState;
  todos: TodoItem[];
  busy: boolean;
  settings: SettingsState | null;
  agentActive: boolean;
  vscode: VsCodeApi;
}) {
  const showTodos = marks.planBlockTodoWrite < 0;
  return (
    <div className="plan-block">
      {marks.planSummaries.map((si) => {
        const summary = log[si];
        if (summary?.kind !== "assistant") return null;
        return (
          <AssistantMessage
            key={`plan-summary-${si}`}
            text={summary.text}
            isFinal={isFinalAssistant(log, si)}
            deferMermaid={agentActive && si === marks.lastAssistant && si === log.length - 1}
            vscode={vscode}
          />
        );
      })}
      <PlanCard
        plan={plan}
        todos={todos}
        busy={busy}
        settings={settings}
        vscode={vscode}
        showTodos={showTodos}
      />
    </div>
  );
}

function ToolLogEntry({
  item,
  index,
  log,
  marks,
  plan,
  todos,
  busy,
  settings,
  agentActive,
  vscode,
}: {
  item: Extract<LogItem, { kind: "tool" }>;
  index: number;
  log: LogItem[];
  marks: LogMarks;
  plan: PlanState | null;
  todos: TodoItem[];
  busy: boolean;
  settings: SettingsState | null;
  agentActive: boolean;
  vscode: VsCodeApi;
}) {
  if (HIDDEN_TOOLS.has(item.name)) return null;
  if (item.name === "write_plan") {
    if (!plan) return null;
    if (index === marks.lastWritePlan) {
      return (
        <PlanBlockEntry
          log={log}
          marks={marks}
          plan={plan}
          todos={todos}
          busy={busy}
          settings={settings}
          agentActive={agentActive}
          vscode={vscode}
        />
      );
    }
    return <PlanCompactRow title={plan.title} planId={plan.id} vscode={vscode} />;
  }
  if (item.name === "todo_write") {
    return <TodoToolCard item={item} defaultOpen={!busy && index === marks.lastTodoWrite} />;
  }
  return <ToolCard item={item} />;
}

function AssistantLogEntry({
  item,
  index,
  log,
  marks,
  agentActive,
  vscode,
}: {
  item: Extract<LogItem, { kind: "assistant" }>;
  index: number;
  log: LogItem[];
  marks: LogMarks;
  agentActive: boolean;
  vscode: VsCodeApi;
}) {
  if (marks.planSummarySet.has(index)) return null;
  return (
    <AssistantMessage
      text={item.text}
      isFinal={isFinalAssistant(log, index)}
      deferMermaid={agentActive && index === marks.lastAssistant && index === log.length - 1}
      vscode={vscode}
    />
  );
}

function StatusLogEntry({
  item,
  index,
  marks,
}: {
  item: Extract<LogItem, { kind: "status" }>;
  index: number;
  marks: LogMarks;
}) {
  const isLive = index === marks.liveStatus;
  return (
    <div className={`msg status msg-enter${isLive ? " status-live" : ""}`}>
      {isLive && <span className="status-live-dot" aria-hidden="true" />}
      <span className={isLive ? "status-live-text" : undefined}>{t(item.text)}</span>
    </div>
  );
}

function RoutingLogEntry({ item }: { item: Extract<LogItem, { kind: "routing" }> }) {
  const label = item.label ?? item.model;
  const title = item.reason
    ? t("Auto chose {0}: {1}", label, item.reason)
    : t("Auto chose {0}", label);
  return (
    <div className="msg routing msg-enter" title={title}>
      <span className="routing-badge">{t("Auto")}</span>
      <span className="routing-model">{label}</span>
      {item.estimatedCredits != null && (
        <span className="routing-credits">
          {t("~{0} credits", String(item.estimatedCredits))}
        </span>
      )}
    </div>
  );
}

interface LogEntryProps {
  item: LogItem;
  index: number;
  log: LogItem[];
  marks: LogMarks;
  editingIndex: number | null;
  setEditingIndex: (i: number | null) => void;
  activeSessionId?: string;
  busy: boolean;
  agentActive: boolean;
  plan: PlanState | null;
  todos: TodoItem[];
  settings: SettingsState | null;
  vscode: VsCodeApi;
}

export function LogEntry(props: LogEntryProps) {
  const { item, index, log, marks, agentActive, vscode } = props;

  switch (item.kind) {
    case "user":
      return <UserLogEntry {...props} item={item} />;
    case "assistant":
      return <AssistantLogEntry item={item} index={index} log={log} marks={marks} agentActive={agentActive} vscode={vscode} />;
    case "reasoning":
      return <ReasoningMessage text={item.text} isLive={index === marks.liveReasoning} />;
    case "tool":
      return <ToolLogEntry {...props} item={item} />;
    case "approval":
      return <ApprovalCard item={item} vscode={vscode} />;
    case "question":
      return <QuestionCard item={item} vscode={vscode} />;
    case "user_action":
      return <UserActionCard item={item} vscode={vscode} />;
    case "error":
      return <div className="msg error msg-enter">{t(item.text)}</div>;
    case "gateway_error":
      return <GatewayErrorCard item={item} vscode={vscode} />;
    case "status":
      return <StatusLogEntry item={item} index={index} marks={marks} />;
    case "routing":
      return <RoutingLogEntry item={item} />;
  }
}
