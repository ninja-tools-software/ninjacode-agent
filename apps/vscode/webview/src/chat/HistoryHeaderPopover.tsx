import { HistoryIcon } from "../icons.js";
import { t } from "../i18n.js";
import { useDismiss } from "./hooks/useDismiss.js";
import { HistoryPanel } from "./panels/HistoryPanel.js";
import type { SessionSummary, VsCodeApi } from "./types.js";

export function HistoryHeaderPopover({
  historyOpen,
  historyClosing,
  historyMounted,
  historySessions,
  historyQuery,
  activeSessionId,
  sessionsLoading,
  onToggle,
  onClose,
  onQuery,
  onOpen,
  onDelete,
  vscode,
}: {
  historyOpen: boolean;
  historyClosing: boolean;
  historyMounted: boolean;
  historySessions: SessionSummary[];
  historyQuery: string;
  activeSessionId?: string;
  sessionsLoading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  vscode: VsCodeApi;
}) {
  const wrapRef = useDismiss<HTMLDivElement>(historyOpen, onClose);
  const label = historyOpen ? t("Hide conversation history") : t("Show conversation history");

  return (
    <div className="history-popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`icon-btn history-toggle${historyOpen ? " active" : ""}`}
        data-tooltip={label}
        aria-label={label}
        aria-expanded={historyOpen}
        disabled={sessionsLoading}
        onClick={onToggle}
      >
        <HistoryIcon size={20} />
      </button>
      {historyMounted && (
        <HistoryPanel
          sessions={historySessions}
          activeSessionId={activeSessionId}
          loading={sessionsLoading}
          query={historyQuery}
          onQuery={onQuery}
          closing={historyClosing}
          onOpen={onOpen}
          onDelete={onDelete}
          vscode={vscode}
        />
      )}
    </div>
  );
}
