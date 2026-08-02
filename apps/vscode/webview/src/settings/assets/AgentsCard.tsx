import { useState } from "react";
import { t } from "../../i18n.js";
import type { CustomAgentItem, ModelInfo, VsCodeApi } from "../../types.js";
import { AssetToolbar, joinList, NEXT_RUN_HINT, splitList, useAssetMessages } from "./shared.js";
import { AgentForm, type AgentDraft } from "./AgentForm.js";
import { AgentList } from "./AgentList.js";

function draftFromAgent(agent?: CustomAgentItem): AgentDraft {
  return {
    path: agent?.path,
    name: agent?.name ?? "",
    description: agent?.description ?? "",
    model: agent?.model ?? "",
    tools: joinList(agent?.tools),
    systemPrompt: agent?.systemPrompt ?? "",
  };
}

export function AgentsCard({
  agents,
  models,
  vscode,
}: {
  agents: CustomAgentItem[];
  models: ModelInfo[];
  vscode: VsCodeApi;
}) {
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  useAssetMessages("agent", { onError: setError });

  const save = () => {
    if (!draft) return;
    vscode.postMessage({
      type: "asset_save",
      kind: "agent",
      path: draft.path,
      payload: {
        name: draft.name,
        description: draft.description,
        model: draft.model,
        tools: splitList(draft.tools),
        systemPrompt: draft.systemPrompt,
      },
    });
    setDraft(null);
  };

  return (
    <div className="card">
      <AssetToolbar
        label={t("Custom agents")}
        hint={t(NEXT_RUN_HINT)}
        onNew={{ label: t("New agent"), onClick: () => setDraft(draftFromAgent()) }}
      />
      {agents.length === 0 && !draft && (
        <p className="muted">
          {t(
            "No custom agent yet. Each one becomes a handoff tool the main agent can delegate to, with its own persona, model and tool allowlist.",
          )}
        </p>
      )}
      <div className="asset-list">
        <AgentList agents={agents} vscode={vscode} onEdit={(a) => setDraft(draftFromAgent(a))} />
      </div>
      {draft && (
        <AgentForm
          draft={draft}
          error={error}
          models={models}
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
