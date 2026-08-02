import { t } from "../../i18n.js";
import { AssetForm } from "./shared.js";
import { SkillFormFields } from "./SkillFormFields.js";
import type { SkillDraft } from "./skillFormTypes.js";

export type { SkillDraft } from "./skillFormTypes.js";

export function SkillForm({
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: SkillDraft;
  error?: string;
  onChange: (draft: SkillDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <AssetForm
      title={draft.path ? t("Edit {0}", draft.name) : t("New skill")}
      error={error}
      onSave={onSave}
      onCancel={onCancel}
    >
      <SkillFormFields draft={draft} onChange={onChange} />
    </AssetForm>
  );
}
