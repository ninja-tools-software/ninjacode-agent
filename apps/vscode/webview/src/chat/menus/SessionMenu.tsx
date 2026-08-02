import { useState } from "react";
import { ArchiveIcon, DotsIcon, EditIcon, ExportIcon, PinIcon } from "../../icons.js";
import { relativeTime } from "../format.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import { useDismiss } from "../hooks/useDismiss.js";
import type { SessionSummary, VsCodeApi } from "../types.js";
import { t } from "../../i18n.js";

function SessionMenuActions({
  session,
  sessionId,
  onRename,
  act,
  vscode,
}: {
  session?: SessionSummary;
  sessionId: string;
  onRename: () => void;
  act: (fn: () => void) => () => void;
  vscode: VsCodeApi;
}) {
  const pinned = session?.pinned ?? false;
  return (
    <>
      {session && (
        <div className="menu-meta">
          {session.turnCount === 1 ? t("{0} turn", session.turnCount) : t("{0} turns", session.turnCount)} · {relativeTime(session.updatedAt)}
        </div>
      )}
      <button className="menu-item" onClick={act(onRename)}>
        <EditIcon size={14} /> {t("Rename")}
      </button>
      <button
        className="menu-item"
        onClick={act(() =>
          vscode.postMessage({ type: "pin_session", sessionId, pinned: !pinned }),
        )}
      >
        <PinIcon size={14} /> {pinned ? t("Unpin") : t("Pin")}
      </button>
      <button
        className="menu-item"
        onClick={act(() =>
          vscode.postMessage({ type: "export_session", sessionId, format: "markdown" }),
        )}
      >
        <ExportIcon size={14} /> {t("Export")}
      </button>
      <button
        className="menu-item"
        onClick={act(() =>
          vscode.postMessage({ type: "archive_session", sessionId, archived: true }),
        )}
      >
        <ArchiveIcon size={14} /> {t("Archive")}
      </button>
    </>
  );
}

export function SessionMenu({
  session,
  sessionId,
  onRename,
  vscode,
}: {
  session?: SessionSummary;
  sessionId?: string;
  onRename: () => void;
  vscode: VsCodeApi;
}) {
  const resolvedSessionId = session?.id ?? sessionId;
  const [open, setOpen] = useState(false);
  const presence = useAnimatedPresence(open);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  if (!resolvedSessionId) return null;

  return (
    <div className="session-menu-wrap" ref={rootRef}>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        data-tooltip={t("More actions")}
        aria-label={t("More actions")}
        onClick={() => setOpen((v) => !v)}
      >
        <DotsIcon size={20} />
      </button>
      {presence.mounted && (
        <div
          className={animCls("menu-popover anim-pop anim-pop-origin-top", presence.closing && "anim-closing")}
          role="menu"
        >
          <SessionMenuActions
            session={session}
            sessionId={resolvedSessionId}
            act={act}
            vscode={vscode}
            onRename={onRename}
          />
        </div>
      )}
    </div>
  );
}
