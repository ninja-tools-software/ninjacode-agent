import { useState } from "react";
import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../types.js";
import { providerHasUrl, providerKeyLabel, type ProviderDrafts } from "./providerHelpers.js";
import { ProviderRowControls } from "./ProviderRowControls.js";

function ProviderUrlField({
  kind,
  urlValue,
  setUrlDrafts,
  vscode,
}: {
  kind: string;
  urlValue: string;
  setUrlDrafts: ProviderDrafts["setUrlDrafts"];
  vscode: VsCodeApi;
}) {
  const meta =
    kind === "gateway"
      ? { label: t("Gateway URL"), placeholder: "http://127.0.0.1:8788" }
      : kind === "local"
        ? { label: t("Local server URL"), placeholder: "http://localhost:11434/v1" }
        : { label: t("Base URL"), placeholder: "https://api.example.com/v1" };

  return (
    <div className="field">
      <label>{meta.label}</label>
      <div className="row">
        <input
          value={urlValue}
          placeholder={meta.placeholder}
          onChange={(e) => setUrlDrafts((d) => ({ ...d, [kind]: e.target.value }))}
          onBlur={(e) =>
            vscode.postMessage({ type: "update_settings", configKind: kind, baseUrl: e.target.value })
          }
        />
        {kind === "local" && (
          <button type="button" className="btn" onClick={() => vscode.postMessage({ type: "get_settings" })}>
            {t("Refresh models")}
          </button>
        )}
      </div>
      {kind === "local" && (
        <p className="muted">
          {t("Start your local server (Ollama, LM Studio, vLLM…) — no API key required.")}
        </p>
      )}
    </div>
  );
}

function ProviderKeyField({
  kind,
  settings,
  apiKeyDrafts,
  setApiKeyDrafts,
  vscode,
}: {
  kind: string;
  settings: SettingsState;
  apiKeyDrafts: Record<string, string>;
  setApiKeyDrafts: ProviderDrafts["setApiKeyDrafts"];
  vscode: VsCodeApi;
}) {
  return (
    <div className="field key-field">
      <label>
        {t(
          "API key {0}",
          settings.hasApiKey[kind]
            ? "••••••••"
            : t(providerKeyLabel(kind, false)),
        )}
      </label>
      <div className="row">
        <input
          type="password"
          placeholder={t("Paste API key…")}
          value={apiKeyDrafts[kind] ?? ""}
          onChange={(e) => setApiKeyDrafts((d) => ({ ...d, [kind]: e.target.value }))}
        />
        <button
          className="btn primary"
          disabled={!apiKeyDrafts[kind]?.trim()}
          onClick={() => {
            vscode.postMessage({ type: "set_api_key", kind, key: apiKeyDrafts[kind] });
            setApiKeyDrafts((d) => ({ ...d, [kind]: "" }));
          }}
        >
          {t("Save")}
        </button>
        <button
          className="btn"
          disabled={!settings.hasApiKey[kind]}
          onClick={() => vscode.postMessage({ type: "clear_api_key", kind })}
        >
          {t("Clear")}
        </button>
      </div>
    </div>
  );
}

interface ProviderItemProps extends ProviderDrafts {
  kind: string;
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  vscode: VsCodeApi;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export function ProviderItem(props: ProviderItemProps) {
  const { kind, settings, isOpen } = props;
  const label = settings.providerLabels[kind] ?? kind;
  const urlValue = props.urlDrafts[kind] ?? settings.baseUrls[kind] ?? "";

  return (
    <div className={`provider-item ${isOpen ? "open" : ""}`}>
      <ProviderRowControls
        kind={kind}
        label={label}
        enabled={settings.providers.includes(kind)}
        isActive={settings.provider === kind}
        hasKey={settings.hasApiKey[kind]}
        isOpen={isOpen}
        settings={settings}
        setSettings={props.setSettings}
        vscode={props.vscode}
        onToggleOpen={props.onToggleOpen}
      />
      {isOpen && (
        <div className="provider-config">
          {providerHasUrl(kind) && (
            <ProviderUrlField
              kind={kind}
              urlValue={urlValue}
              setUrlDrafts={props.setUrlDrafts}
              vscode={props.vscode}
            />
          )}
          {kind !== "mock" && (
            <ProviderKeyField
              kind={kind}
              settings={settings}
              apiKeyDrafts={props.apiKeyDrafts}
              setApiKeyDrafts={props.setApiKeyDrafts}
              vscode={props.vscode}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function useProviderExpanded() {
  return useState<string | null>(null);
}
