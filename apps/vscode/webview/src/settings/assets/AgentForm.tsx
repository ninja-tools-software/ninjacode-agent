import { t } from "../../i18n.js";
import type { ModelInfo } from "../../types.js";
import { AssetForm } from "./shared.js";
import { AgentFormFields } from "./AgentFormFields.js";
import type { AgentDraft } from "./agentFormTypes.js";

export type { AgentDraft } from "./agentFormTypes.js";

export function AgentForm({
  draft,
  error,
  models,
  onChange,
  onSave,
  onCancel,
}: {
  draft: AgentDraft;
  error?: string;
  models: ModelInfo[];
  onChange: (draft: AgentDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <AssetForm
      title={draft.path ? t("Edit {0}", draft.name) : t("New custom agent")}
      error={error}
      onSave={onSave}
      onCancel={onCancel}
    >
      <AgentFormFields draft={draft} models={models} onChange={onChange} />
    </AssetForm>
  );
}
