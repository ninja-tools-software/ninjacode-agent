import { t } from "../../i18n.js";
import type { McpServerStatusItem, VsCodeApi } from "../../types.js";
import { AssetToolbar } from "./shared.js";
import { draftFromServer } from "./mcpDraft.js";
import { McpServerForm } from "./McpServerForm.js";
import { McpServerList } from "./McpServerList.js";
import { useMcpDraft } from "./useMcpDraft.js";

export function McpServersCard({
  servers,
  configFile,
  vscode,
}: {
  servers: McpServerStatusItem[];
  configFile: string | null;
  vscode: VsCodeApi;
}) {
  const { draft, setDraft, error, setError, save } = useMcpDraft(vscode);

  return (
    <div className="card">
      <AssetToolbar
        label={t("MCP servers")}
        hint={configFile ?? ".ninjacode/mcp.json"}
        onNew={{ label: t("Add server"), onClick: () => setDraft(draftFromServer()) }}
      >
        <button className="btn subtle" onClick={() => vscode.postMessage({ type: "get_mcp_status" })}>
          {t("Reconnect")}
        </button>
      </AssetToolbar>
      {servers.length === 0 && !draft && (
        <p className="muted">{t("No MCP server yet. Add one to give the agent extra tools.")}</p>
      )}
      <div className="asset-list">
        <McpServerList servers={servers} configFile={configFile} vscode={vscode} onEdit={setDraft} />
      </div>
      {draft && (
        <McpServerForm
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
