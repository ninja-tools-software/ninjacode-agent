import { t } from "../../i18n.js";
import { Field, KeyValueRows } from "./shared.js";
import type { McpDraft } from "./mcpDraft.js";

export function McpStdioFields({
  draft,
  onChange,
}: {
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
}) {
  return (
    <>
      <Field label={t("Command")}>
        <input
          value={draft.command}
          placeholder="npx"
          onChange={(e) => onChange({ ...draft, command: e.target.value })}
        />
      </Field>
      <Field label={t("Arguments")} hint={t("one per line")}>
        <textarea
          rows={3}
          value={draft.args}
          placeholder={"-y\n@modelcontextprotocol/server-filesystem\n."}
          onChange={(e) => onChange({ ...draft, args: e.target.value })}
        />
      </Field>
      <Field
        label={t("Environment")}
        hint={t("use ${env:NAME} to read a variable instead of storing a secret")}
      >
        <KeyValueRows
          rows={draft.env}
          onChange={(env) => onChange({ ...draft, env })}
          keyPlaceholder="API_TOKEN"
          valuePlaceholder="${env:API_TOKEN}"
        />
      </Field>
    </>
  );
}

export function McpHttpFields({
  draft,
  onChange,
}: {
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
}) {
  return (
    <>
      <Field label={t("URL")}>
        <input
          value={draft.url}
          placeholder="https://example.com/mcp"
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
        />
      </Field>
      <Field
        label={t("Headers")}
        hint={t("use ${env:NAME} to read a variable instead of storing a secret")}
      >
        <KeyValueRows
          rows={draft.headers}
          onChange={(headers) => onChange({ ...draft, headers })}
          keyPlaceholder="Authorization"
          valuePlaceholder="Bearer ${env:MY_TOKEN}"
        />
      </Field>
    </>
  );
}
