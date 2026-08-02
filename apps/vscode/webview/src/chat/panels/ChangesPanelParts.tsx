import { ChatIcon, CheckIcon, CloseIcon, DotsIcon } from "../../icons.js";
import type { ChangeItem, HunkItem, VsCodeApi } from "../types.js";
import { CollapseChevron } from "./TodoList.js";
import { t } from "../../i18n.js";

function HunkList({
  path,
  hunks,
  vscode,
}: {
  path: string;
  hunks: HunkItem[];
  vscode: VsCodeApi;
}) {
  return (
    <ul className="hunk-list">
      {hunks.length === 0 && (
        <li className="muted hunk-empty">{t("No line-level hunks to show yet (or fully resolved).")}</li>
      )}
      {hunks.map((h) => (
        <li key={h.id} className="hunk-item">
          <pre className="hunk-diff">
            {h.currentLines.map((l, i) => (
              <div key={`d${i}`} className="hunk-line del">
                -{l}
              </div>
            ))}
            {h.afterLines.map((l, i) => (
              <div key={`a${i}`} className="hunk-line add">
                +{l}
              </div>
            ))}
          </pre>
          <div className="hunk-actions">
            <button
              className="icon-btn"
              data-tooltip={t("Accept this hunk")}
              aria-label={t("Accept this hunk")}
              onClick={() => vscode.postMessage({ type: "accept_hunk", path, hunkId: h.id })}
            >
              <CheckIcon size={12} />
            </button>
            <button
              className="icon-btn"
              data-tooltip={t("Reject this hunk")}
              aria-label={t("Reject this hunk")}
              onClick={() => vscode.postMessage({ type: "reject_hunk", path, hunkId: h.id })}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChangesBulkActions({ vscode }: { vscode: VsCodeApi }) {
  return (
    <>
      <button
        className="btn"
        data-tooltip={t("Accept all proposed file changes")}
        onClick={() => vscode.postMessage({ type: "accept_all" })}
      >
        {t("Accept all")}
      </button>
      <button
        className="btn danger"
        data-tooltip={t("Reject all proposed file changes")}
        onClick={() => vscode.postMessage({ type: "reject_all" })}
      >
        {t("Reject all")}
      </button>
    </>
  );
}

function AutoAcceptBadge({
  autoAcceptRemaining,
  vscode,
}: {
  autoAcceptRemaining: number;
  vscode: VsCodeApi;
}) {
  if (autoAcceptRemaining <= 0) return null;
  return (
    <span className="auto-accept-badge">
      {t("Auto-accepting in {0}s", autoAcceptRemaining)}
      <button
        className="chip-remove"
        data-tooltip={t("Cancel auto-accept")}
        aria-label={t("Cancel auto-accept")}
        onClick={() => vscode.postMessage({ type: "cancel_auto_accept" })}
      >
        <CloseIcon size={11} />
      </button>
    </span>
  );
}

export function ChangesPanelHeader({
  collapsed,
  onToggleCollapsed,
  changes,
  totalAdd,
  totalDel,
  autoAcceptRemaining,
  vscode,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  changes: ChangeItem[];
  totalAdd: number;
  totalDel: number;
  autoAcceptRemaining: number;
  vscode: VsCodeApi;
}) {
  return (
    <div className="dock-panel-header changes-header">
      <button
        type="button"
        className="dock-panel-toggle collapsible-header"
        aria-expanded={!collapsed}
        onClick={onToggleCollapsed}
      >
        <span className="collapsible-title">
          <CollapseChevron collapsed={collapsed} />
          <strong>{t("Changes")}</strong>
        </span>
      </button>
      <div className="dock-panel-actions">
        <span className="muted changes-summary">
          {changes.length} file{changes.length === 1 ? "" : "s"}
          {totalAdd > 0 && <span className="stat-add"> +{totalAdd}</span>}
          {totalDel > 0 && <span className="stat-del"> -{totalDel}</span>}
        </span>
        <AutoAcceptBadge autoAcceptRemaining={autoAcceptRemaining} vscode={vscode} />
        <ChangesBulkActions vscode={vscode} />
      </div>
    </div>
  );
}

function ChangeFeedbackBox({
  feedbackText,
  onFeedbackText,
  onSend,
  onCancel,
}: {
  feedbackText: string;
  onFeedbackText: (v: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="feedback-box">
      <input
        autoFocus
        value={feedbackText}
        placeholder={t("What should change about this edit?")}
        onChange={(e) => onFeedbackText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSend();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button
        className="btn primary"
        data-tooltip={t("Send feedback to the agent about this edit")}
        onClick={onSend}
      >
        {t("Send")}
      </button>
    </div>
  );
}

function ChangeListItemActions({
  path,
  onToggleHunks,
  onToggleFeedback,
  vscode,
}: {
  path: string;
  onToggleHunks: (path: string) => void;
  onToggleFeedback: (path: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="change-actions">
      <button
        className="icon-btn"
        data-tooltip={t("Show hunks")}
        aria-label={t("Show hunks")}
        onClick={() => onToggleHunks(path)}
      >
        <DotsIcon size={13} />
      </button>
      <button
        className="icon-btn"
        data-tooltip={t("Send feedback about this edit")}
        aria-label={t("Send feedback about this edit")}
        onClick={() => onToggleFeedback(path)}
      >
        <ChatIcon size={13} />
      </button>
      <button
        className="icon-btn"
        data-tooltip={t("Accept this file")}
        aria-label={t("Accept this file")}
        onClick={() => vscode.postMessage({ type: "accept_edit", path })}
      >
        <CheckIcon size={13} />
      </button>
      <button
        className="icon-btn"
        data-tooltip={t("Reject this file")}
        aria-label={t("Reject this file")}
        onClick={() => vscode.postMessage({ type: "reject_edit", path })}
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

function ChangeListItemRow({
  change,
  onToggleHunks,
  onToggleFeedback,
  vscode,
}: {
  change: ChangeItem;
  onToggleHunks: (path: string) => void;
  onToggleFeedback: (path: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="change-row">
      <button
        className="change-path"
        data-tooltip="Open diff"
        onClick={() => vscode.postMessage({ type: "review_edit", path: change.path })}
      >
        {change.sensitive && (
          <span className="badge warn" data-tooltip="Always reviewed">
            sensitive
          </span>
        )}
        <span className="change-path-label">{change.path}</span>
      </button>
      <span className="change-stats">
        {change.additions > 0 && <span className="stat-add">+{change.additions}</span>}
        {change.deletions > 0 && <span className="stat-del">-{change.deletions}</span>}
      </span>
      <ChangeListItemActions
        path={change.path}
        onToggleHunks={onToggleHunks}
        onToggleFeedback={onToggleFeedback}
        vscode={vscode}
      />
    </div>
  );
}

export function ChangeListItem({
  change,
  expandedHunksPath,
  feedbackForPath,
  feedbackText,
  hunksByPath,
  onToggleHunks,
  onToggleFeedback,
  onFeedbackText,
  onSendFeedback,
  vscode,
}: {
  change: ChangeItem;
  expandedHunksPath: string | null;
  feedbackForPath: string | null;
  feedbackText: string;
  hunksByPath: Record<string, HunkItem[]>;
  onToggleHunks: (path: string) => void;
  onToggleFeedback: (path: string) => void;
  onFeedbackText: (v: string) => void;
  onSendFeedback: (path: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <li className="change-item">
      <ChangeListItemRow
        change={change}
        onToggleHunks={onToggleHunks}
        onToggleFeedback={onToggleFeedback}
        vscode={vscode}
      />
      {feedbackForPath === change.path && (
        <ChangeFeedbackBox
          feedbackText={feedbackText}
          onFeedbackText={onFeedbackText}
          onSend={() => onSendFeedback(change.path)}
          onCancel={() => onToggleFeedback(change.path)}
        />
      )}
      {expandedHunksPath === change.path && (
        <HunkList path={change.path} hunks={hunksByPath[change.path] ?? []} vscode={vscode} />
      )}
    </li>
  );
}

export function useChangesPanelActions(opts: {
  expandedHunksPath: string | null;
  setExpandedHunksPath: (p: string | null) => void;
  feedbackForPath: string | null;
  setFeedbackForPath: (p: string | null) => void;
  feedbackText: string;
  setFeedbackText: (v: string) => void;
  vscode: VsCodeApi;
}) {
  const {
    expandedHunksPath,
    setExpandedHunksPath,
    feedbackForPath,
    setFeedbackForPath,
    feedbackText,
    setFeedbackText,
    vscode,
  } = opts;

  const toggleHunks = (p: string) => {
    if (expandedHunksPath === p) {
      setExpandedHunksPath(null);
      return;
    }
    setExpandedHunksPath(p);
    vscode.postMessage({ type: "get_hunks", path: p });
  };

  const toggleFeedback = (p: string) => {
    setFeedbackForPath(feedbackForPath === p ? null : p);
  };

  const sendFeedback = (p: string) => {
    if (!feedbackText.trim()) return;
    vscode.postMessage({ type: "send_feedback", path: p, text: feedbackText.trim() });
    setFeedbackText("");
    setFeedbackForPath(null);
  };

  return { toggleHunks, toggleFeedback, sendFeedback };
}
