import { useState } from "react";
import type { SettingsState, VsCodeApi } from "../../types.js";

const URL_PROVIDERS = new Set(["openai-compatible", "gateway", "local"]);

export function providerHasUrl(kind: string) {
  return URL_PROVIDERS.has(kind);
}

export function providerKeyLabel(kind: string, hasKey: boolean) {
  if (hasKey) return "••••••••";
  if (kind === "local") return "(optional)";
  return "(empty)";
}

export type ProviderDrafts = {
  urlDrafts: Record<string, string>;
  setUrlDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  apiKeyDrafts: Record<string, string>;
  setApiKeyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
};

export function useProviderDrafts(): ProviderDrafts {
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  return { urlDrafts, setUrlDrafts, apiKeyDrafts, setApiKeyDrafts };
}

export function toggleProviderList(
  settings: SettingsState,
  kind: string,
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>,
  vscode: VsCodeApi,
) {
  const set = new Set(settings.providers);
  if (set.has(kind)) {
    if (set.size <= 1) return;
    set.delete(kind);
  } else {
    set.add(kind);
  }
  const providers = [...set];
  setSettings((prev) => (prev ? { ...prev, providers } : prev));
  vscode.postMessage({ type: "update_settings", providers });
}

export function setActiveProviderKind(
  kind: string,
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>,
  vscode: VsCodeApi,
) {
  // Clear the previous provider's model list until the host round-trips
  // the new catalog — otherwise the UI briefly shows the wrong models.
  setSettings((prev) =>
    prev ? { ...prev, provider: kind, models: [], model: "", modelInfo: undefined } : prev,
  );
  vscode.postMessage({ type: "update_settings", provider: kind });
}
