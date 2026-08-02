import { useState } from "react";
import { animCls } from "../hooks/useAnimatedPresence.js";
import type { ChangeItem, HunkItem, VsCodeApi } from "../types.js";
import {
  ChangeListItem,
  ChangesPanelHeader,
  useChangesPanelActions,
} from "./ChangesPanelParts.js";

interface ChangesPanelProps {
  changes: ChangeItem[];
  autoAcceptRemaining: number;
  expandedHunksPath: string | null;
  setExpandedHunksPath: (p: string | null) => void;
  hunksByPath: Record<string, HunkItem[]>;
  feedbackForPath: string | null;
  setFeedbackForPath: (p: string | null) => void;
  feedbackText: string;
  setFeedbackText: (v: string) => void;
  closing?: boolean;
  vscode: VsCodeApi;
}

export function ChangesPanel({
  changes,
  autoAcceptRemaining,
  expandedHunksPath,
  setExpandedHunksPath,
  hunksByPath,
  feedbackForPath,
  setFeedbackForPath,
  feedbackText,
  setFeedbackText,
  closing,
  vscode,
}: ChangesPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const totalAdd = changes.reduce((s, c) => s + c.additions, 0);
  const totalDel = changes.reduce((s, c) => s + c.deletions, 0);
  const { toggleHunks, toggleFeedback, sendFeedback } = useChangesPanelActions({
    expandedHunksPath,
    setExpandedHunksPath,
    feedbackForPath,
    setFeedbackForPath,
    feedbackText,
    setFeedbackText,
    vscode,
  });

  return (
    <div className={animCls("changes-panel panel-enter", closing && "anim-closing")}>
      <ChangesPanelHeader
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((v) => !v)}
        changes={changes}
        totalAdd={totalAdd}
        totalDel={totalDel}
        autoAcceptRemaining={autoAcceptRemaining}
        vscode={vscode}
      />
      {!collapsed && (
        <ul className="changes-list">
          {changes.map((c) => (
            <ChangeListItem
              key={c.path}
              change={c}
              expandedHunksPath={expandedHunksPath}
              feedbackForPath={feedbackForPath}
              feedbackText={feedbackText}
              hunksByPath={hunksByPath}
              onToggleHunks={toggleHunks}
              onToggleFeedback={toggleFeedback}
              onFeedbackText={setFeedbackText}
              onSendFeedback={sendFeedback}
              vscode={vscode}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
