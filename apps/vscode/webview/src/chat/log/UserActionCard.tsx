import { useState } from "react";
import { t } from "../../i18n.js";
import type { UserActionLogItem, VsCodeApi } from "../types.js";

export function UserActionCard({ item, vscode }: { item: UserActionLogItem; vscode: VsCodeApi }) {
  const [comment, setComment] = useState("");

  const done = () =>
    vscode.postMessage({
      type: "user_action_done",
      requestId: item.requestId,
      comment: comment.trim() || undefined,
    });

  return (
    <div className={`user-action-card panel-enter msg-enter${item.resolved ? " resolved" : ""}`}>
      <div className="user-action-header">
        <span className="user-action-icon">⏸</span>
        <strong>{t("Manual action required")}</strong>
      </div>
      <p className="user-action-text">{item.action}</p>
      {item.reason && <p className="muted user-action-reason">{item.reason}</p>}
      {item.resolved ? (
        <div className="user-action-footer muted">
          {item.cancelled
            ? t("Cancelled — the run was stopped.")
            : item.comment
              ? t("Done — {0}", item.comment)
              : t("Done — the run resumed.")}
        </div>
      ) : (
        <div className="user-action-actions">
          <input
            className="question-free-text"
            type="text"
            placeholder={t("Optional comment for the agent…")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") done();
            }}
          />
          <button className="btn primary" onClick={done}>
            {t("I'm done — resume")}
          </button>
        </div>
      )}
    </div>
  );
}
