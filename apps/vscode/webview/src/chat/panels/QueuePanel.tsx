import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "../../icons.js";
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
        <strong>Queued</strong>
        <span className="muted">
          {queue.length} message{queue.length === 1 ? "" : "s"} — will send after the current run
        </span>
      </div>
      <ul className="queue-list">
        {queue.map((q, i) => (
          <li key={q.id} className="queue-item">
            <span className="queue-text">{q.text}</span>
            <div className="queue-actions">
              <button
                className="icon-btn"
                data-tooltip="Move up"
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => vscode.postMessage({ type: "reorder_queue", queueId: q.id, direction: "up" })}
              >
                <ArrowUpIcon size={12} />
              </button>
              <button
                className="icon-btn"
                data-tooltip="Move down"
                aria-label="Move down"
                disabled={i === queue.length - 1}
                onClick={() =>
                  vscode.postMessage({ type: "reorder_queue", queueId: q.id, direction: "down" })
                }
              >
                <ArrowDownIcon size={12} />
              </button>
              <button
                className="icon-btn"
                data-tooltip="Remove"
                aria-label="Remove"
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
