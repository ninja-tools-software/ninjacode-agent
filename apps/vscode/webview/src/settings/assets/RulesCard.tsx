import { t } from "../../i18n.js";
import { AssetToolbar, NEXT_RUN_HINT } from "./shared.js";
import type { RuleItem, VsCodeApi } from "../../types.js";
import { RuleForm, RuleRow } from "./RuleForm.js";
import { useRuleDraft } from "./useRuleDraft.js";

export function RulesCard({ rules, vscode }: { rules: RuleItem[]; vscode: VsCodeApi }) {
  const { draft, setDraft, error, setError, pending, edit, save } = useRuleDraft(vscode);

  return (
    <div className="card">
      <AssetToolbar
        label={t("Rules & instructions")}
        hint={t(NEXT_RUN_HINT)}
        onNew={{
          label: t("New rule"),
          onClick: () =>
            setDraft({ name: "", description: "", globs: "", alwaysApply: true, body: "" }),
        }}
      />
      {rules.length === 0 && !draft && (
        <p className="muted">
          {t(
            "No rule file found. Add one to teach the agent your conventions — it lands in {0}.",
            ".ninjacode/rules/",
          )}
        </p>
      )}
      <div className="asset-list">
        {rules.map((r) => (
          <RuleRow key={r.path} rule={r} vscode={vscode} onEdit={() => edit(r)} />
        ))}
      </div>
      {pending && <p className="muted">{t("Loading {0}…", pending.path)}</p>}
      {draft && (
        <RuleForm
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
