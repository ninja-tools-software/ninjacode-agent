import { useEffect, useMemo, useState } from "react";
import { t } from "../../i18n.js";
import { formatContextWindow, type SettingsState, type VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";

function ActiveModelCard({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  return (
    <div className="card">
      <div className="card__label">{t("Active model")}</div>
      <select
        className="select"
        value={settings.model}
        onChange={(e) => vscode.postMessage({ type: "update_settings", model: e.target.value })}
      >
        {settings.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      {settings.modelInfo && (
        <p className="muted">
          {t(
            "{0} context · {1} max output",
            formatContextWindow(settings.modelInfo.contextWindow),
            formatContextWindow(settings.modelInfo.maxOutput),
          )}
        </p>
      )}
    </div>
  );
}

function ContextWindowCard({ settings, presets, vscode }: {
  settings: SettingsState;
  presets: number[];
  vscode: VsCodeApi;
}) {
  return (
    <div className="card">
      <div className="card__label">{t("Context window")}</div>
      <p className="muted">
        {t("Cap the history sent to the model. Lower values compact sooner and cost less.")}
      </p>
      <div className="segmented wrap">
        <button
          className={settings.contextWindow === 0 ? "active" : ""}
          onClick={() => vscode.postMessage({ type: "update_settings", contextWindow: 0 })}
        >
          {t("Auto")}
        </button>
        {presets.map((p) => (
          <button
            key={p}
            className={settings.contextWindow === p ? "active" : ""}
            onClick={() => vscode.postMessage({ type: "update_settings", contextWindow: p })}
          >
            {formatContextWindow(p)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReasoningCard({
  settings,
  budget,
  setBudget,
  vscode,
}: {
  settings: SettingsState;
  budget: number;
  setBudget: (n: number) => void;
  vscode: VsCodeApi;
}) {
  const reasoning = settings.modelInfo?.reasoning;

  if (reasoning?.kind === "levels") {
    return (
      <div className="card">
        <div className="card__label">{t("Reasoning")}</div>
        <div className="segmented">
          {reasoning.levels.map((level) => (
            <button
              key={level}
              className={settings.reasoningEffort === level ? "active" : ""}
              onClick={() => vscode.postMessage({ type: "update_settings", reasoningEffort: level })}
            >
              {level}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (reasoning?.kind === "budget") {
    return (
      <div className="card">
        <div className="card__label">{t("Reasoning")}</div>
        <div className="field">
          <label>{t("Thinking budget: {0} tokens", budget.toLocaleString())}</label>
          <input
            type="range"
            min={reasoning.min}
            max={reasoning.max}
            step={1000}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            onMouseUp={() => vscode.postMessage({ type: "update_settings", thinkingBudgetTokens: budget })}
            onKeyUp={() => vscode.postMessage({ type: "update_settings", thinkingBudgetTokens: budget })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card__label">{t("Reasoning")}</div>
      <p className="muted">{t("This model has no reasoning controls.")}</p>
    </div>
  );
}

export function ModelSection({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  const [budget, setBudget] = useState(settings.thinkingBudgetTokens);
  useEffect(() => setBudget(settings.thinkingBudgetTokens), [settings.thinkingBudgetTokens]);
  const presets = useMemo(() => settings.contextPresets ?? [], [settings.contextPresets]);

  return (
    <SettingsSection
      id="models"
      title={t("Model & reasoning")}
      description={t("Applies to new turns in the chat. Model lists refresh live from the active provider.")}
    >
      <div className="settings-grid">
        <ActiveModelCard settings={settings} vscode={vscode} />
        <ContextWindowCard settings={settings} presets={presets} vscode={vscode} />
        <ReasoningCard settings={settings} budget={budget} setBudget={setBudget} vscode={vscode} />
      </div>
    </SettingsSection>
  );
}
