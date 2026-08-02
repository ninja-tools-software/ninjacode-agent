import { MODE_META } from "../../chat/modes.js";
import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../types.js";
import { APPROVAL_MODES } from "../constants.js";
import { SettingsSection } from "../SettingsSection.js";

const LOCALE_OPTIONS = [
  { id: "auto" as const, label: "Follow VS Code Display Language" },
  { id: "en" as const, label: "English" },
  { id: "fr" as const, label: "Français" },
];

export function AgentSection({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  return (
    <SettingsSection
      id="agent"
      title={t("Agent preferences")}
      description={t(
        "Defaults for new conversations. The chat header can still override the mode per session.",
      )}
    >
      <div className="settings-grid settings-grid--pair">
        <div className="card">
          <div className="card__label">{t("Default mode")}</div>
          <div className="option-list">
            {MODE_META.map((m) => (
              <button
                key={m.id}
                className={`option ${settings.mode === m.id ? "active" : ""}`}
                onClick={() => vscode.postMessage({ type: "update_settings", mode: m.id })}
              >
                <strong>{t(m.label)}</strong>
                <span className="muted">{t(m.hint)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__label">{t("Approvals")}</div>
          <div className="option-list">
            {APPROVAL_MODES.map((a) => (
              <button
                key={a.id}
                className={`option ${settings.approvalMode === a.id ? "active" : ""}`}
                onClick={() => vscode.postMessage({ type: "update_settings", approvalMode: a.id })}
              >
                <strong>{t(a.label)}</strong>
                <span className="muted">{t(a.hint)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card__label">{t("Language")}</div>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("UI language for NinjaCode chat and settings.")}
        </p>
        <div className="option-list">
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`option ${settings.localeSetting === opt.id ? "active" : ""}`}
              onClick={() => vscode.postMessage({ type: "set_locale", locale: opt.id })}
            >
              <strong>{t(opt.label)}</strong>
            </button>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
