import { useState } from "react";
import type { OpenTabId } from "./state/openTabs.js";
import type { SessionSummary, VsCodeApi } from "./types.js";

export function useAppHeaderRename(activeSession: SessionSummary | undefined, vscode: VsCodeApi) {
  const [renamingTabId, setRenamingTabId] = useState<OpenTabId | undefined>();
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = () => {
    if (!activeSession) return;
    setRenameDraft(activeSession.title);
    setRenamingTabId(activeSession.id);
  };

  const commitRename = () => {
    if (!activeSession || !renamingTabId) return;
    vscode.postMessage({
      type: "rename_session",
      sessionId: activeSession.id,
      title: renameDraft.trim(),
    });
    setRenamingTabId(undefined);
  };

  return {
    renamingTabId,
    renameDraft,
    setRenameDraft,
    startRename,
    commitRename,
    cancelRename: () => setRenamingTabId(undefined),
  };
}
