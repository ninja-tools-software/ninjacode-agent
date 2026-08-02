import { t } from "../../i18n.js";
import { ALL_PROVIDERS, type SettingsState, type VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";
import { ProviderItem, useProviderExpanded } from "./ProviderItem.js";
import { useProviderDrafts } from "./providerHelpers.js";

export function ProvidersSection({
  settings,
  setSettings,
  vscode,
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState | null>>;
  vscode: VsCodeApi;
}) {
  const drafts = useProviderDrafts();
  const [expanded, setExpanded] = useProviderExpanded();

  return (
    <SettingsSection
      id="providers"
      title={t("Providers & keys")}
      description={t(
        "Enable the providers you use, pick the active one, and store keys in the OS keychain (never in settings.json).",
      )}
    >
      <div className="provider-list">
        {ALL_PROVIDERS.map((kind) => (
          <ProviderItem
            key={kind}
            kind={kind}
            settings={settings}
            setSettings={setSettings}
            vscode={vscode}
            isOpen={expanded === kind}
            onToggleOpen={() => setExpanded(expanded === kind ? null : kind)}
            {...drafts}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
