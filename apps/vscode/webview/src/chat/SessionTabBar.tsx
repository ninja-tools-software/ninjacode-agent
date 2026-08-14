import { t } from "../i18n.js";
import { SessionTab } from "./SessionTab.js";
import { isDraftTab, tabTitleFor, type OpenTabId } from "./state/openTabs.js";
import type { SessionSummary } from "./types.js";

const NEW_CHAT_TITLE = "New Chat";

function displayTabTitle(title: string): string {
  return title === NEW_CHAT_TITLE ? t(NEW_CHAT_TITLE) : title;
}

export function SessionTabBar({
  tabIds,
  activeTabId,
  sessions,
  fallbackTitles,
  renamingTabId,
  renameDraft,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onClose,
}: {
  tabIds: OpenTabId[];
  activeTabId: OpenTabId;
  sessions: SessionSummary[];
  fallbackTitles?: Record<string, string>;
  renamingTabId?: OpenTabId;
  renameDraft?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onSelect: (tabId: OpenTabId) => void;
  onClose: (tabId: OpenTabId) => void;
}) {
  return (
    <div className="session-tab-bar" role="tablist" aria-label={t("Open conversations")}>
      {tabIds.map((tabId) => {
        const { title, pinned } = tabTitleFor(tabId, sessions, fallbackTitles);
        const active = tabId === activeTabId;
        const renaming = renamingTabId === tabId && !isDraftTab(tabId);
        return (
          <SessionTab
            key={tabId}
            title={displayTabTitle(title)}
            active={active}
            pinned={pinned}
            renaming={renaming}
            renameValue={renameDraft}
            onRenameChange={onRenameChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            onSelect={() => onSelect(tabId)}
            onClose={() => onClose(tabId)}
          />
        );
      })}
    </div>
  );
}
