import { useState } from "react";
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
        <strong>Manual action required</strong>
      </div>
      <p className="user-action-text">{item.action}</p>
      {item.reason && <p className="muted user-action-reason">{item.reason}</p>}
      {item.resolved ? (
        <div className="user-action-footer muted">
          {item.cancelled
            ? "Cancelled — the run was stopped."
            : item.comment
              ? `Done — ${item.comment}`
              : "Done — the run resumed."}
        </div>
      ) : (
        <div className="user-action-actions">
          <input
            className="question-free-text"
            type="text"
            placeholder="Optional comment for the agent…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") done();
            }}
          />
          <button className="btn primary" onClick={done}>
            I&apos;m done — resume
          </button>
        </div>
      )}
    </div>
  );
}
