import { t } from "../../i18n.js";
import { Field } from "./shared.js";
import type { SkillDraft } from "./skillFormTypes.js";

export function SkillFormFields({
  draft,
  onChange,
}: {
  draft: SkillDraft;
  onChange: (draft: SkillDraft) => void;
}) {
  return (
    <>
      <div className="asset-form__grid">
        <Field label={t("Name")}>
          <input
            value={draft.name}
            placeholder="release-checklist"
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("Context")}>
          <div className="segmented">
            {(["inline", "fork"] as const).map((c) => (
              <button
                key={c}
                className={draft.context === c ? "active" : ""}
                onClick={() => onChange({ ...draft, context: c })}
              >
                {t(c)}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <Field label={t("Description")} hint={t("shown to the model in the skills index")}>
        <input
          value={draft.description}
          placeholder={t("Use when cutting a release")}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </Field>
      {draft.context === "fork" && (
        <Field label={t("Allowed tools")} hint={t("comma separated, empty means all")}>
          <input
            value={draft.allowedTools}
            placeholder="read_file, grep, run_shell"
            onChange={(e) => onChange({ ...draft, allowedTools: e.target.value })}
          />
        </Field>
      )}
      <Field label={t("Instructions")} hint={t("markdown")}>
        <textarea
          rows={12}
          value={draft.body}
          placeholder={t("## Steps\n1. …")}
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
        />
      </Field>
    </>
  );
}
