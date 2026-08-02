import { useCallback } from "react";
import type { ContextQueryType, VsCodeApi } from "../types.js";
import type { PendingTarget } from "./useComposerResolution.types.js";

export function useComposerQueuePicks(
  vscode: VsCodeApi,
  queueAt: (at: PendingTarget) => string,
) {
  const queueContextPick = useCallback(
    (pickerType: ContextQueryType, item: { id: string; label: string }) =>
      vscode.postMessage({
        type: "resolve_context_item",
        queryType: pickerType,
        contextId: item.id,
        contextLabel: item.label,
        requestId: queueAt({ at: "caret" }),
      }),
    [queueAt, vscode],
  );

  const queueSelectionPick = useCallback(
    () => vscode.postMessage({ type: "get_current_selection", requestId: queueAt({ at: "caret" }) }),
    [queueAt, vscode],
  );

  const queueFilesPick = useCallback(
    () => vscode.postMessage({ type: "pick_files_native", requestId: queueAt({ at: "caret" }) }),
    [queueAt, vscode],
  );

  return { queueContextPick, queueSelectionPick, queueFilesPick };
}
