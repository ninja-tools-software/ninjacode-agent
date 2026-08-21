import { useState } from "react";
import { CloseIcon, LoaderIcon, SearchIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { CollapseChevron } from "../panels/TodoList.js";
import type { LogItem, ToolLogItem } from "../types.js";
import type { ExplorationGroup } from "./explorationGroups.js";
import { ToolCard } from "./ToolCard.js";

interface GroupSummary {
  running: ToolLogItem | undefined;
  errors: number;
  durationMs: number;
}

function summarize(tools: ToolLogItem[]): GroupSummary {
  let running: ToolLogItem | undefined;
  let errors = 0;
  let durationMs = 0;
  for (const tool of tools) {
    if (tool.status === "running") running = tool;
    if (tool.status === "error") errors++;
    durationMs += tool.durationMs ?? 0;
  }
  return { running, errors, durationMs };
}

function GroupIcon({ summary }: { summary: GroupSummary }) {
  if (summary.running) return <LoaderIcon size={12} />;
  if (summary.errors > 0) return <CloseIcon size={12} />;
  return <SearchIcon size={12} />;
}

function groupToolItems(log: LogItem[], group: ExplorationGroup): ToolLogItem[] {
  const items: ToolLogItem[] = [];
  for (const index of group.tools) {
    const item = log[index];
    if (item?.kind === "tool") items.push(item);
  }
  return items;
}

/**
 * One collapsible node for a run of information-gathering calls. Collapsed by default,
 * including while running: the header names the call in flight so the run stays legible
 * without the log scrolling away under a stack of read cards.
 */
export function ExplorationGroupCard({ group, log }: { group: ExplorationGroup; log: LogItem[] }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const tools = groupToolItems(log, group);
  const summary = summarize(tools);
  const open = override ?? summary.errors > 0;
  const status = summary.running ? "running" : summary.errors > 0 ? "error" : "done";
  return (
    <div className={`tool-card tool-group tool-${status} msg-enter${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="tool-header collapsible-header"
        aria-expanded={open}
        onClick={() => setOverride(!open)}
      >
        <span className={`tool-status tool-status-${status}`} aria-hidden="true">
          <GroupIcon summary={summary} />
        </span>
        <span className="tool-label">
          {summary.running ? t("Exploring") : t("Explored {0} tools", tools.length)}
        </span>
        <div className="tool-meta">
          {summary.running && <span className="tool-target">{summary.running.label}</span>}
          {summary.errors > 0 && (
            <span className="tool-group-errors">{t("{0} failed", summary.errors)}</span>
          )}
          {!summary.running && summary.durationMs > 0 && (
            <span className="tool-duration">{summary.durationMs}ms</span>
          )}
        </div>
        <CollapseChevron collapsed={!open} />
      </button>
      {open && (
        <div className="tool-group-body">
          {tools.map((item) => (
            <ToolCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
