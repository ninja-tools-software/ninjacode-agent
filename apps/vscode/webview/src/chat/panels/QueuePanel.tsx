import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import type { QueuedMessage, VsCodeApi } from "../types.js";

export function QueuePanel({
  queue,
  closing,
  vscode,
}: {
  queue: QueuedMessage[];
  closing?: boolean;
  vscode: VsCodeApi;
}) {
  return (
    <div className={animCls("queue-panel panel-enter", closing && "anim-closing")}>
      <div className="queue-header">
        <strong>{t("Queued")}</strong>
        <span className="muted">
          {queue.length === 1
            ? t("{0} message — will send after the current run", queue.length)
            : t("{0} messages — will send after the current run", queue.length)}
        </span>
      </div>
      <ul className="queue-list">
        {queue.map((q, i) => (
          <li key={q.id} className="queue-item">
            <span className="queue-text">{q.text}</span>
            <div className="queue-actions">
              <button
                className="icon-btn"
                data-tooltip={t("Move up")}
                aria-label={t("Move up")}
                disabled={i === 0}
                onClick={() => vscode.postMessage({ type: "reorder_queue", queueId: q.id, direction: "up" })}
              >
                <ArrowUpIcon size={12} />
              </button>
              <button
                className="icon-btn"
                data-tooltip={t("Move down")}
                aria-label={t("Move down")}
                disabled={i === queue.length - 1}
                onClick={() =>
                  vscode.postMessage({ type: "reorder_queue", queueId: q.id, direction: "down" })
                }
              >
                <ArrowDownIcon size={12} />
              </button>
              <button
                className="icon-btn"
                data-tooltip={t("Remove")}
                aria-label={t("Remove")}
                onClick={() => vscode.postMessage({ type: "remove_queued", queueId: q.id })}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
