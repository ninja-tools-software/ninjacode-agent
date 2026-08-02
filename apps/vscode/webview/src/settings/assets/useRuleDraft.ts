import { useState } from "react";
import type { RuleItem, VsCodeApi } from "../../types.js";
import { joinList, splitList, useAssetMessages } from "./shared.js";
import type { RuleDraft } from "./RuleForm.js";

function useRuleDraft(vscode: VsCodeApi) {
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<RuleItem | null>(null);

  useAssetMessages("rule", {
    onError: setError,
    onBody: (id, data) => {
      if (!pending || pending.path !== id) return;
      setDraft({
        path: pending.path,
        name: pending.path.split("/").pop() ?? pending.path,
        description: String(data.description ?? ""),
        globs: joinList(data.globs as string[] | undefined),
        alwaysApply: data.alwaysApply !== false,
        body: String(data.body ?? ""),
      });
      setPending(null);
    },
  });

  const edit = (rule: RuleItem) => {
    setError(undefined);
    setPending(rule);
    vscode.postMessage({ type: "get_asset_body", kind: "rule", id: rule.path, path: rule.path });
  };

  const save = () => {
    if (!draft) return;
    vscode.postMessage({
      type: "asset_save",
      kind: "rule",
      path: draft.path,
      payload: {
        name: draft.name,
        description: draft.description,
        globs: splitList(draft.globs),
        alwaysApply: draft.alwaysApply,
        body: draft.body,
      },
    });
    setDraft(null);
  };

  return { draft, setDraft, error, setError, pending, edit, save };
}

export { useRuleDraft };
