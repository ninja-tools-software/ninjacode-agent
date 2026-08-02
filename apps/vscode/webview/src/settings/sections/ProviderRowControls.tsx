import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../types.js";
import { setActiveProviderKind, toggleProviderList } from "./providerHelpers.js";

export function ProviderRowControls({
  kind,
  label,
  enabled,
  isActive,
  hasKey,
  isOpen,
  settings,
  setSettings,
  vscode,
  onToggleOpen,
}: {
  kind: string;
  label: string;
  enabled: boolean;
  isActive: boolean;
  hasKey: boolean;
  isOpen: boolean;
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  vscode: VsCodeApi;
  onToggleOpen: () => void;
}) {
  return (
    <div className="provider-row">
      <input
        type="checkbox"
        checked={enabled}
        onChange={() => toggleProviderList(settings, kind, setSettings, vscode)}
        aria-label={t("Enable {0}", label)}
      />
      <button type="button" className="provider-toggle grow" aria-expanded={isOpen} onClick={onToggleOpen}>
        <span className={`chevron ${isOpen ? "open" : ""}`}>›</span>
        <span>{label}</span>
      </button>
      {hasKey ? <span className="badge ok">{t("key")}</span> : <span className="badge">{t("no key")}</span>}
      <button
        type="button"
        className={`chip-btn ${isActive ? "active" : ""}`}
        disabled={!enabled}
        onClick={() => setActiveProviderKind(kind, setSettings, vscode)}
      >
        {isActive ? t("Active") : t("Use")}
      </button>
    </div>
  );
}
