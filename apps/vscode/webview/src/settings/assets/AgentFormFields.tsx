import { t } from "../../i18n.js";
import type { ModelInfo } from "../../types.js";
import { Field } from "./shared.js";
import type { AgentDraft } from "./agentFormTypes.js";

export function AgentFormFields({
  draft,
  models,
  onChange,
}: {
  draft: AgentDraft;
  models: ModelInfo[];
  onChange: (draft: AgentDraft) => void;
}) {
  return (
    <>
      <div className="asset-form__grid">
        <Field label={t("Name")}>
          <input
            value={draft.name}
            placeholder="reviewer"
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("Model")} hint={t("empty uses the active model")}>
          <select
            className="select"
            value={draft.model}
            onChange={(e) => onChange({ ...draft, model: e.target.value })}
          >
            <option value="">{t("Same as chat")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("Description")} hint={t("shown in the handoff tool description")}>
        <input
          value={draft.description}
          placeholder={t("Reviews diffs for bugs and missing tests")}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </Field>
      <Field label={t("Tools")} hint={t("comma separated allowlist, empty means all")}>
        <input
          value={draft.tools}
          placeholder="read_file, grep, run_shell"
          onChange={(e) => onChange({ ...draft, tools: e.target.value })}
        />
      </Field>
      <Field label={t("Instructions")} hint={t("the persona's system prompt")}>
        <textarea
          rows={12}
          value={draft.systemPrompt}
          placeholder={t("You are a meticulous reviewer…")}
          onChange={(e) => onChange({ ...draft, systemPrompt: e.target.value })}
        />
      </Field>
    </>
  );
}
