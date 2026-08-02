import type { ToolLogItem } from "../types.js";

function statusGlyph(status: ToolLogItem["status"]): string {
  return status === "running" ? "◌" : status === "error" ? "✗" : "✓";
}

function statusClass(status: ToolLogItem["status"]): string {
  return status === "running" ? "tool-status tool-status-running" : `tool-status tool-status-${status}`;
}

/** Header shared by the plain tool card and the todo variant. */
export function ToolSummary({ item, withLineRange }: { item: ToolLogItem; withLineRange?: boolean }) {
  // The title already embeds the target (e.g. "Reading fluid-sim.js"), so only
  // surface it on the right when it isn't already part of the label.
  const showTarget = Boolean(item.target && !item.label.includes(item.target));
  const hasMeta = showTarget || (withLineRange && item.lineRange) || item.durationMs != null;
  return (
    <summary>
      <span className={statusClass(item.status)}>{statusGlyph(item.status)}</span>
      <span className="tool-label">{item.label}</span>
      {hasMeta ? (
        <div className="tool-meta">
          {showTarget && <span className="tool-target">{item.target}</span>}
          {withLineRange && item.lineRange && <span className="tool-line-range">{item.lineRange}</span>}
          {item.durationMs != null && item.status !== "running" && (
            <span className="tool-duration">{item.durationMs}ms</span>
          )}
        </div>
      ) : null}
    </summary>
  );
}

export function ToolCard({ item }: { item: ToolLogItem }) {
  const body = item.output ?? item.error;
  return (
    <details className={`tool-card tool-${item.status} msg-enter`} open={item.status === "running"}>
      <ToolSummary item={item} withLineRange />
      {(item.argsPreview || body) && (
        <div className="tool-body">
          {item.argsPreview && (
            <div className="tool-section">
              <div className="tool-section-title">Input</div>
              <pre>{item.argsPreview}</pre>
            </div>
          )}
          {body && (
            <div className="tool-section">
              <div className="tool-section-title">{item.status === "error" ? "Error" : "Output"}</div>
              <pre>{body}</pre>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
