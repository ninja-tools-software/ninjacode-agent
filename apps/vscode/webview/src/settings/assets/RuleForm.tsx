import { t } from "../../i18n.js";
import type { RuleItem, VsCodeApi } from "../../types.js";
import { AssetForm, AssetRow, Field } from "./shared.js";

export interface RuleDraft {
  path?: string;
  name: string;
  description: string;
  globs: string;
  alwaysApply: boolean;
  body: string;
}

export function RuleForm({
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: RuleDraft;
  error?: string;
  onChange: (draft: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <AssetForm
      title={draft.path ? t("Edit {0}", draft.path) : t("New rule")}
      error={error}
      onSave={onSave}
      onCancel={onCancel}
    >
      {!draft.path && (
        <Field label={t("Name")} hint={t("becomes .ninjacode/rules/<name>.md")}>
          <input
            value={draft.name}
            placeholder="typescript-conventions"
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
      )}
      <div className="asset-form__grid">
        <Field label={t("Description")}>
          <input
            value={draft.description}
            placeholder={t("How we write TypeScript here")}
            onChange={(e) => onChange({ ...draft, description: e.target.value })}
          />
        </Field>
        <Field label={t("Scope")} hint={t("globs, comma separated")}>
          <input
            value={draft.globs}
            placeholder="src/**/*.ts"
            onChange={(e) => onChange({ ...draft, globs: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("Content")} hint={t("markdown")}>
        <textarea
          rows={14}
          value={draft.body}
          placeholder={t("- Prefer … over …")}
          onChange={(e) => onChange({ ...draft, body: e.target.value })}
        />
      </Field>
    </AssetForm>
  );
}

function ruleSummary(rule: RuleItem) {
  if (!rule.enabled) return <>{t("Disabled — excluded from the system prompt")}</>;
  if (rule.included) return <>{t("{0} chars in the prompt", rule.chars ?? 0)}</>;
  return (
    <>
      {rule.reason
        ? t("Not included — {0}", rule.reason)
        : t("Not included")}
    </>
  );
}

export function RuleRow({
  rule,
  vscode,
  onEdit,
}: {
  rule: RuleItem;
  vscode: VsCodeApi;
  onEdit: () => void;
}) {
  return (
    <AssetRow
      title={rule.path}
      enabled={rule.enabled}
      onToggle={() =>
        vscode.postMessage({
          type: "asset_toggle",
          kind: "rule",
          id: rule.path,
          enabled: !rule.enabled,
        })
      }
      onEdit={onEdit}
      onOpen={() => vscode.postMessage({ type: "asset_open", kind: "rule", path: rule.path })}
      onDelete={() =>
        vscode.postMessage({ type: "asset_delete", kind: "rule", id: rule.path, path: rule.path })
      }
      badges={
        <>
          <span className="badge">{rule.kind}</span>
          {rule.globs?.length ? (
            <span className="badge muted" data-tooltip={t("Only relevant for these files")}>
              {rule.globs.join(", ")}
            </span>
          ) : null}
        </>
      }
      summary={ruleSummary(rule)}
    />
  );
}
