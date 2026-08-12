import { t } from "../../i18n.js";
import type { ApprovalLogItem, VsCodeApi } from "../types.js";

function resolvedApprovalLabel(item: ApprovalLogItem): string {
  if (item.cancelled) return t("Cancelled — the run was stopped.");
  if (item.approved) {
    return item.remember ? t("Always approved.") : t("Approved.");
  }
  return t("Denied.");
}

export function ApprovalCard({ item, vscode }: { item: ApprovalLogItem; vscode: VsCodeApi }) {
  return (
    <div
      className={`approval panel-enter msg-enter ${item.resolved ? "resolved" : ""} ${
        item.danger ? "irreversible" : ""
      }`}
    >
      <div className="approval-body">
        <strong>{t("Approve {0}?", item.toolName)}</strong>
        {item.danger ? (
          <p className="approval-warning">
            {t("This action cannot be undone. Read the command before approving.")}
          </p>
        ) : null}
        <p>{item.reason}</p>
        <code>{item.target}</code>
      </div>
      {item.resolved ? (
        <div className="approval-actions">
          <span className="muted">{resolvedApprovalLabel(item)}</span>
        </div>
      ) : (
        <div className="approval-actions">
          <button
            className="btn"
            data-tooltip={t("Approve this tool call once")}
            onClick={() => vscode.postMessage({ type: "approve", requestId: item.requestId })}
          >
            {t("Approve")}
          </button>
          {/* No "Always" for an irreversible call: every one of them is decided on its own. */}
          {item.danger ? null : (
            <button
              className="btn"
              data-tooltip={
                item.grantScope
                  ? t("Always allow this command type: {0}", item.grantScope)
                  : t("Always approve this tool for this target")
              }
              onClick={() =>
                vscode.postMessage({ type: "approve_always", requestId: item.requestId })
              }
            >
              {item.grantScope ? t("Always allow {0}", item.grantScope) : t("Always")}
            </button>
          )}
          <button
            className="btn danger"
            data-tooltip={t("Deny this tool call")}
            onClick={() => vscode.postMessage({ type: "deny", requestId: item.requestId })}
          >
            {t("Deny")}
          </button>
        </div>
      )}
    </div>
  );
}
