import { useState } from "react";
import { CheckIcon, CloseIcon, LoaderIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { CollapseChevron } from "../panels/TodoList.js";
import type { ToolLogItem } from "../types.js";

function ToolStatusIcon({ status }: { status: ToolLogItem["status"] }) {
  if (status === "running") return <LoaderIcon size={12} />;
  if (status === "error") return <CloseIcon size={12} />;
  return <CheckIcon size={12} />;
}

function statusClass(status: ToolLogItem["status"]): string {
  return status === "running" ? "tool-status tool-status-running" : `tool-status tool-status-${status}`;
}

/** Header shared by the plain tool card and the todo variant. */
export function ToolSummary({
  item,
  withLineRange,
  open,
  onToggle,
}: {
  item: ToolLogItem;
  withLineRange?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const showTarget = Boolean(item.target && !item.label.includes(item.target));
  const hasMeta = showTarget || (withLineRange && item.lineRange) || item.durationMs != null;
  return (
    <button
      type="button"
      className="tool-header collapsible-header"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className={statusClass(item.status)} aria-hidden="true">
        <ToolStatusIcon status={item.status} />
      </span>
      <span className="tool-label">{item.label}</span>
      {hasMeta ? (
        <div className="tool-meta">
          {showTarget && <span className="tool-target">{item.target}</span>}
          {withLineRange && item.lineRange && <span className="tool-line-range">{item.lineRange}</span>}
          {item.durationMs != null && item.status !== "running" && (
            <span className="tool-duration">{item.durationMs}ms</span>
          )}
        </div>
      ) : (
        <span />
      )}
      <CollapseChevron collapsed={!open} />
    </button>
  );
}

export function ToolCard({ item }: { item: ToolLogItem }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? item.status === "running";
  const body = item.output ?? item.error;
  const hasBody = Boolean(item.argsPreview || body);
  return (
    <div className={`tool-card tool-${item.status} msg-enter${open ? " is-open" : ""}`}>
      <ToolSummary
        item={item}
        withLineRange
        open={open}
        onToggle={() => setOverride(!open)}
      />
      {open && hasBody && (
        <div className="tool-body">
          {item.argsPreview && (
            <div className="tool-section">
              <div className="tool-section-title">{t("Input")}</div>
              <pre>{item.argsPreview}</pre>
            </div>
          )}
          {body && (
            <div className="tool-section">
              <div className="tool-section-title">{item.status === "error" ? t("Error") : t("Output")}</div>
              <pre>{body}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
