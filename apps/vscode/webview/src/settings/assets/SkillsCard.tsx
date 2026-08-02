import { useState } from "react";
import { t } from "../../i18n.js";
import type { SkillItem, VsCodeApi } from "../../types.js";
import { AssetToolbar, joinList, NEXT_RUN_HINT, splitList, useAssetMessages } from "./shared.js";
import { SkillForm, type SkillDraft } from "./SkillForm.js";
import { SkillList } from "./SkillList.js";

function useSkillDraft(vscode: VsCodeApi) {
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState<SkillItem | null>(null);

  useAssetMessages("skill", {
    onError: setError,
    onBody: (id, data) => {
      if (!pending || pending.name !== id) return;
      setDraft({
        path: pending.path,
        name: pending.name,
        description: pending.description,
        context: pending.context,
        allowedTools: joinList(pending.allowedTools),
        body: String(data.body ?? ""),
      });
      setPending(null);
    },
  });

  const edit = (skill: SkillItem) => {
    setError(undefined);
    setPending(skill);
    vscode.postMessage({ type: "get_asset_body", kind: "skill", id: skill.name, path: skill.path });
  };

  const save = () => {
    if (!draft) return;
    vscode.postMessage({
      type: "asset_save",
      kind: "skill",
      path: draft.path,
      payload: {
        name: draft.name,
        description: draft.description,
        context: draft.context,
        allowedTools: splitList(draft.allowedTools),
        body: draft.body,
      },
    });
    setDraft(null);
  };

  return { draft, setDraft, error, setError, pending, edit, save };
}

export function SkillsCard({ skills, vscode }: { skills: SkillItem[]; vscode: VsCodeApi }) {
  const { draft, setDraft, error, setError, pending, edit, save } = useSkillDraft(vscode);

  return (
    <div className="card">
      <AssetToolbar
        label={t("Skills")}
        hint={t(NEXT_RUN_HINT)}
        onNew={{
          label: t("New skill"),
          onClick: () =>
            setDraft({ name: "", description: "", context: "inline", allowedTools: "", body: "" }),
        }}
      />
      {skills.length === 0 && !draft && (
        <p className="muted">
          {t("No skill yet. A skill is a reusable playbook the agent can load on demand with {0}.", "use_skill")}
        </p>
      )}
      <div className="asset-list">
        <SkillList skills={skills} vscode={vscode} onEdit={edit} />
      </div>
      {pending && <p className="muted">{t("Loading {0}…", pending.name)}</p>}
      {draft && (
        <SkillForm
          draft={draft}
          error={error}
          onChange={setDraft}
          onSave={save}
          onCancel={() => {
            setDraft(null);
            setError(undefined);
          }}
        />
      )}
    </div>
  );
}
