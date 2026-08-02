import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveIcon, CheckIcon, DotsIcon, ExportIcon, PinIcon, TrashIcon } from "../../icons.js";
import { groupSessionsByRecency } from "../format.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import { useAnchoredMenu } from "../hooks/useAnchoredMenu.js";
import type { SessionSummary, VsCodeApi } from "../types.js";

interface HistoryPanelProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  loading: boolean;
  query: string;
  onQuery: (q: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  closing?: boolean;
  vscode: VsCodeApi;
}

function HistoryItemMenu({
  session,
  menu,
  vscode,
}: {
  session: SessionSummary;
  menu: ReturnType<typeof useAnchoredMenu>;
  vscode: VsCodeApi;
}) {
  if (!menu.mounted) return null;
  return createPortal(
    <div
      ref={menu.menuRef}
      className={animCls("history-item-menu anim-pop", menu.closing && "anim-closing")}
      style={menu.menuStyle}
      role="menu"
    >
      <button
        type="button"
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation();
          menu.setOpen(false);
          vscode.postMessage({
            type: "archive_session",
            sessionId: session.id,
            archived: !session.archived,
          });
        }}
      >
        <ArchiveIcon size={14} /> {session.archived ? "Unarchive" : "Archive"}
      </button>
      <button
        type="button"
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation();
          menu.setOpen(false);
          vscode.postMessage({
            type: "export_session",
            sessionId: session.id,
            format: "markdown",
          });
        }}
      >
        <ExportIcon size={14} /> Export
      </button>
    </div>,
    document.body,
  );
}

function HistoryItemMain({
  session,
  active,
  onOpen,
}: {
  session: SessionSummary;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="history-main"
      data-tooltip={`Open conversation: ${session.title}`}
      onClick={() => onOpen(session.id)}
    >
      <span className="history-active-icon" aria-hidden="true">
        {active ? <CheckIcon size={10} /> : null}
      </span>
      <span className="history-title">
        {session.pinned && (
          <span className="history-pin" data-tooltip="Pinned">
            <PinIcon size={9} filled />
          </span>
        )}
        {session.title}
      </span>
    </button>
  );
}

function HistoryItemActions({
  session,
  menu,
  onDelete,
  vscode,
}: {
  session: SessionSummary;
  menu: ReturnType<typeof useAnchoredMenu>;
  onDelete: (id: string) => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="history-item-actions">
      <button
        type="button"
        className="icon-btn"
        data-tooltip={session.pinned ? "Unpin" : "Pin"}
        aria-label={session.pinned ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "pin_session", sessionId: session.id, pinned: !session.pinned });
        }}
      >
        <PinIcon size={12} />
      </button>
      <div className="history-item-menu-wrap">
        <button
          ref={menu.buttonRef}
          type="button"
          className={`icon-btn${menu.open ? " active" : ""}`}
          data-tooltip="More actions"
          aria-label="More actions"
          aria-expanded={menu.open}
          onClick={(e) => {
            e.stopPropagation();
            menu.toggle();
          }}
        >
          <DotsIcon size={12} />
        </button>
        <HistoryItemMenu session={session} menu={menu} vscode={vscode} />
      </div>
      <button
        type="button"
        className="icon-btn"
        data-tooltip="Delete"
        aria-label="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(session.id);
        }}
      >
        <TrashIcon size={12} />
      </button>
    </div>
  );
}

function HistoryItem({
  session,
  active,
  onOpen,
  onDelete,
  vscode,
}: {
  session: SessionSummary;
  active: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  vscode: VsCodeApi;
}) {
  const menu = useAnchoredMenu();

  return (
    <li
      className={`history-item${active ? " active" : ""}${session.archived ? " archived" : ""}`}
    >
      <HistoryItemMain session={session} active={active} onOpen={onOpen} />
      <HistoryItemActions session={session} menu={menu} onDelete={onDelete} vscode={vscode} />
    </li>
  );
}

function HistoryArchivedToggle({
  archivedCount,
  showArchived,
  onToggle,
}: {
  archivedCount: number;
  showArchived: boolean;
  onToggle: () => void;
}) {
  if (archivedCount === 0) return null;
  return (
    <button type="button" className="history-archived-toggle" onClick={onToggle}>
      {showArchived ? "Hide archived" : `Show ${archivedCount} archived`}
    </button>
  );
}

export function HistoryPanel({
  sessions,
  activeSessionId,
  loading,
  query,
  onQuery,
  onOpen,
  onDelete,
  closing,
  vscode,
}: HistoryPanelProps) {
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = sessions.filter((s) => s.archived).length;
  const visible = useMemo(
    () => sessions.filter((s) => showArchived || !s.archived),
    [sessions, showArchived],
  );
  const groups = useMemo(() => groupSessionsByRecency(visible), [visible]);

  return (
    <div className={animCls("history-panel anim-slide-right", closing && "anim-closing")}>
      <input
        className="history-search"
        value={query}
        placeholder="Search conversations…"
        onChange={(e) => onQuery(e.target.value)}
      />
      <div className="history-scroll">
        {loading && <p className="muted history-empty">Loading…</p>}
        {!loading && visible.length === 0 && (
          <p className="muted history-empty">No conversations yet.</p>
        )}
        {groups.map((group) => (
          <section key={group.label}>
            <div className="history-group-label">{group.label}</div>
            <ul className="history-list">
              {group.sessions.map((s) => (
                <HistoryItem
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onOpen={onOpen}
                  onDelete={onDelete}
                  vscode={vscode}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <HistoryArchivedToggle
        archivedCount={archivedCount}
        showArchived={showArchived}
        onToggle={() => setShowArchived((v) => !v)}
      />
    </div>
  );
}
