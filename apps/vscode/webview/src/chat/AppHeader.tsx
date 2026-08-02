import { SessionTabBar } from "./SessionTabBar.js";
import { AppHeaderActions } from "./AppHeaderActions.js";
import type { AppHeaderProps } from "./AppHeader.types.js";
import { useAppHeaderRename } from "./useAppHeaderRename.js";

export function AppHeader(props: AppHeaderProps) {
  const rename = useAppHeaderRename(props.activeSession, props.vscode);

  return (
    <header className="app-header">
      <SessionTabBar
        tabIds={props.tabIds}
        activeTabId={props.activeTabId}
        sessions={props.sessions}
        fallbackTitles={props.fallbackTitles}
        renamingTabId={rename.renamingTabId}
        renameDraft={rename.renameDraft}
        onRenameChange={rename.setRenameDraft}
        onRenameCommit={rename.commitRename}
        onRenameCancel={rename.cancelRename}
        onSelect={props.onTabSelect}
        onClose={props.onTabClose}
      />
      <AppHeaderActions {...props} onRename={rename.startRename} />
    </header>
  );
}
