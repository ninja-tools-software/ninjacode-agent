import { useState } from "react";
import { PlayIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../types.js";
import { PlanModelPicker } from "./PlanModelPicker.js";

function executeShortcutLabel(): string {
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
  return isMac ? "⌘⏎" : "Ctrl+⏎";
}

export function ExecutePlanButton({
  busy,
  settings,
  vscode,
  onExecute,
}: {
  busy: boolean;
  settings: SettingsState | null;
  vscode: VsCodeApi;
  /** When set, execution is delegated to the parent (e.g. plan tab with local model state). */
  onExecute?: (model?: string) => void;
}) {
  const defaultModel = settings?.model;
  const [selectedModel, setSelectedModel] = useState<string | undefined>(defaultModel);

  const execute = () => {
    const model = selectedModel ?? defaultModel;
    if (onExecute) onExecute(model);
    else vscode.postMessage({ type: "execute_plan", ...(model ? { model } : {}) });
  };

  return (
    <div className="plan-execute-wrap">
      <PlanModelPicker
        busy={busy}
        settings={settings}
        vscode={vscode}
        onModelChange={setSelectedModel}
      />
      <button
        type="button"
        className="btn-execute"
        disabled={busy}
        data-tooltip={t("Switch to Agent mode and implement this plan")}
        onClick={execute}
      >
        <PlayIcon size={14} />
        <span>{t("Execute plan")}</span>
        <kbd className="btn-execute-kbd">{executeShortcutLabel()}</kbd>
      </button>
    </div>
  );
}
