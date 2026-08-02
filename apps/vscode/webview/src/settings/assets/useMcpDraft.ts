import { useState } from "react";
import type { VsCodeApi } from "../../types.js";
import { rowsToRecord, splitList, useAssetMessages } from "./shared.js";
import type { McpDraft } from "./mcpDraft.js";

export function useMcpDraft(vscode: VsCodeApi) {
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  useAssetMessages("mcp", { onError: setError });

  const save = () => {
    if (!draft) return;
    setError(undefined);
    vscode.postMessage({
      type: "asset_save",
      kind: "mcp",
      previousId: draft.previousName,
      payload: {
        name: draft.name,
        transport: draft.transport,
        command: draft.command,
        args: splitList(draft.args),
        url: draft.url,
        env: rowsToRecord(draft.env),
        headers: rowsToRecord(draft.headers),
        enabled: draft.enabled,
      },
    });
    setDraft(null);
  };

  return { draft, setDraft, error, setError, save };
}
