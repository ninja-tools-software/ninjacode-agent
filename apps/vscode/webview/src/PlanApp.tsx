import { useCallback, useEffect, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown.js";
import { PlayIcon } from "./icons.js";
import { t } from "./i18n.js";
import { PlanModelPicker } from "./chat/panels/PlanModelPicker.js";
import type { SettingsState, VsCodeApi } from "./chat/types.js";

interface PlanDocState {
  planId: string;
  title: string;
  relPath: string;
  content: string;
  models: SettingsState["models"];
  model: string;
  busy: boolean;
}

function usePlanDoc(vscode: VsCodeApi) {
  const [doc, setDoc] = useState<PlanDocState | null>(null);
  const [settings, setSettings] = useState<SettingsState | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string };
      if (msg.type !== "plan_doc") return;
      const payload = msg as PlanDocState & { type: "plan_doc" };
      setDoc({
        planId: payload.planId,
        title: payload.title,
        relPath: payload.relPath,
        content: payload.content,
        models: payload.models ?? [],
        model: payload.model,
        busy: payload.busy,
      });
      setSettings({
        model: payload.model,
        models: payload.models ?? [],
      } as SettingsState);
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [vscode]);

  return { doc, settings };
}

function PlanAppLoading() {
  return (
    <div className="plan-app">
      <p className="muted plan-app-loading">{t("Loading plan…")}</p>
    </div>
  );
}

function PlanAppToolbar({
  doc,
  mergedSettings,
  vscode,
  onExecute,
}: {
  doc: PlanDocState;
  mergedSettings: SettingsState | null;
  vscode: VsCodeApi;
  onExecute: () => void;
}) {
  return (
    <header className="plan-app-toolbar">
      <div className="plan-app-title">
        <strong>{doc.title || t("Plan")}</strong>
        <span className="muted plan-app-path" data-tooltip={doc.relPath}>
          {doc.relPath}
        </span>
      </div>
      <div className="plan-app-actions">
        <button
          type="button"
          className="btn"
          data-tooltip={t("Open markdown preview in the editor")}
          onClick={() => vscode.postMessage({ type: "open_plan_markdown" })}
        >
          {t("Open markdown")}
        </button>
        <div className="plan-execute-wrap">
          <PlanModelPicker busy={doc.busy} settings={mergedSettings} vscode={vscode} />
          <button
            type="button"
            className="btn-execute"
            disabled={doc.busy}
            data-tooltip={t("Switch to Agent mode and implement this plan")}
            onClick={onExecute}
          >
            <PlayIcon size={14} />
            <span>{t("Execute plan")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

export function PlanApp({ vscode }: { vscode: VsCodeApi }) {
  const { doc, settings } = usePlanDoc(vscode);

  const execute = useCallback(() => {
    vscode.postMessage({ type: "execute_plan", ...(doc?.model ? { model: doc.model } : {}) });
  }, [doc?.model, vscode]);

  if (!doc) return <PlanAppLoading />;

  const mergedSettings: SettingsState | null = settings
    ? { ...settings, model: doc.model, models: doc.models }
    : null;

  return (
    <div className="plan-app screen-enter">
      <PlanAppToolbar doc={doc} mergedSettings={mergedSettings} vscode={vscode} onExecute={execute} />
      <div className="plan-app-body">
        <div className="md">
          <ChatMarkdown>{doc.content}</ChatMarkdown>
        </div>
      </div>
    </div>
  );
}
