import { t } from "../../i18n.js";
import { AssetForm, Field } from "./shared.js";
import type { McpDraft } from "./mcpDraft.js";
import { McpHttpFields, McpStdioFields } from "./McpTransportFields.js";

export function McpServerForm({
  draft,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  draft: McpDraft;
  error?: string;
  onChange: (draft: McpDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <AssetForm
      title={draft.previousName ? t("Edit {0}", draft.previousName) : t("New MCP server")}
      error={error}
      onSave={onSave}
      onCancel={onCancel}
    >
      <div className="asset-form__grid">
        <Field label={t("Name")}>
          <input
            value={draft.name}
            placeholder="my-server"
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label={t("Transport")}>
          <div className="segmented">
            {(["stdio", "http"] as const).map((transport) => (
              <button
                key={transport}
                className={draft.transport === transport ? "active" : ""}
                onClick={() => onChange({ ...draft, transport })}
              >
                {transport}
              </button>
            ))}
          </div>
        </Field>
      </div>
      {draft.transport === "stdio" ? (
        <McpStdioFields draft={draft} onChange={onChange} />
      ) : (
        <McpHttpFields draft={draft} onChange={onChange} />
      )}
    </AssetForm>
  );
}
