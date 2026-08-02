import { SettingsIcon } from "../icons.js";
import type { SettingsState, VsCodeApi } from "../types.js";
import { t } from "../i18n.js";

export function SettingsTopbar({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  const activeProviderLabel = settings.providerLabels[settings.provider] ?? settings.provider;

  return (
    <header className="settings-topbar">
      <div className="settings-topbar__title">
        <SettingsIcon size={16} />
        <h1>{t("NinjaCode Settings")}</h1>
      </div>
      <div className="settings-topbar__meta">
        <span className="settings-chip" data-tooltip={t("Active provider and model")}>
          {activeProviderLabel}
          <span className="settings-chip__sep">/</span>
          {settings.modelInfo?.label ?? (settings.model || t("no model"))}
        </span>
        <button
          className="btn"
          data-tooltip={t("Reload models, account and workspace info")}
          onClick={() => vscode.postMessage({ type: "get_settings" })}
        >
          {t("Refresh")}
        </button>
      </div>
    </header>
  );
}
