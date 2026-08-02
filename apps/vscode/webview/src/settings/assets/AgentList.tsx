import { t } from "../../i18n.js";
import type { CustomAgentItem, VsCodeApi } from "../../types.js";
import { AssetRow, isManaged } from "./shared.js";

export function AgentList({
  agents,
  vscode,
  onEdit,
}: {
  agents: CustomAgentItem[];
  vscode: VsCodeApi;
  onEdit: (agent: CustomAgentItem) => void;
}) {
  return (
    <>
      {agents.map((a) => (
        <AssetRow
          key={a.name}
          title={a.name}
          enabled={a.enabled}
          onToggle={() =>
            vscode.postMessage({
              type: "asset_toggle",
              kind: "agent",
              id: a.name,
              enabled: !a.enabled,
            })
          }
          onEdit={() => onEdit(a)}
          onOpen={() => vscode.postMessage({ type: "asset_open", kind: "agent", path: a.path })}
          onDelete={() =>
            vscode.postMessage({ type: "asset_delete", kind: "agent", id: a.name, path: a.path })
          }
          badges={
            <>
              {a.model && <span className="badge">{a.model}</span>}
              {!isManaged(a.source) && <span className="badge muted">{a.source}</span>}
            </>
          }
          summary={a.description || <em>{t("No description")}</em>}
        />
      ))}
    </>
  );
}
