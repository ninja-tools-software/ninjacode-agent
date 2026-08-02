import { t } from "../../i18n.js";
import type { McpServerStatusItem, VsCodeApi } from "../../types.js";
import { AssetRow } from "./shared.js";
import { draftFromServer } from "./mcpDraft.js";

function McpToolsDetails({ tools }: { tools: McpServerStatusItem["tools"] }) {
  if (tools.length === 0) return undefined;
  return (
    <details className="asset-row__details">
      <summary className="muted">{t("Tools")}</summary>
      <ul className="mcp-tools">
        {tools.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>
            {tool.description && <span className="muted"> — {tool.description}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function toolCountLabel(count: number): string {
  return count === 1 ? t("{0} tool", count) : t("{0} tools", count);
}

export function McpServerList({
  servers,
  configFile,
  vscode,
  onEdit,
}: {
  servers: McpServerStatusItem[];
  configFile: string | null;
  vscode: VsCodeApi;
  onEdit: (draft: ReturnType<typeof draftFromServer>) => void;
}) {
  return (
    <>
      {servers.map((s) => (
        <AssetRow
          key={s.name}
          title={s.name}
          enabled={s.status !== "disabled"}
          onToggle={() =>
            vscode.postMessage({
              type: "asset_toggle",
              kind: "mcp",
              id: s.name,
              enabled: s.status === "disabled",
            })
          }
          onEdit={() => onEdit(draftFromServer(s.config ?? { name: s.name }))}
          onOpen={
            configFile
              ? () => vscode.postMessage({ type: "asset_open", kind: "mcp", path: configFile })
              : undefined
          }
          onDelete={() => vscode.postMessage({ type: "asset_delete", kind: "mcp", id: s.name })}
          badges={
            <span className={`badge ${s.status === "connected" ? "ok" : s.status === "error" ? "err" : ""}`}>
              {t(s.status)}
            </span>
          }
          summary={
            <>
              {s.transport} · {toolCountLabel(s.toolCount)}
              {s.error && <span className="mcp-error"> — {s.error}</span>}
            </>
          }
          details={<McpToolsDetails tools={s.tools} />}
        />
      ))}
    </>
  );
}
