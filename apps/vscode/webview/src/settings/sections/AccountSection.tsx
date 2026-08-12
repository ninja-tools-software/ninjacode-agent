import { t } from "../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";
import { AccountCreditsCard } from "./account/AccountCreditsCard.js";
import { AccountSignInCard } from "./account/AccountSignInCard.js";
import { AccountUsageTable } from "./account/AccountUsageTable.js";
import { CreditPacksCard } from "./account/CreditPacksCard.js";
import { OverageCard } from "./account/OverageCard.js";
import { PlansCard } from "./account/PlansCard.js";

export function AccountSection({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  return (
    <SettingsSection
      id="account"
      title={t("Account & credits")}
      description={t(
        "NinjaCode Pass is the recommended way to connect — one subscription, monthly credits, every frontier model.",
      )}
    >
      <div className="settings-grid">
        {settings.account ? (
          <AccountCreditsCard settings={settings} vscode={vscode} />
        ) : (
          <AccountSignInCard vscode={vscode} gatewayUrl={settings.baseUrls.gateway ?? ""} />
        )}
        {settings.account && <AccountUsageTable settings={settings} />}
      </div>
      {settings.account?.overage && <OverageCard settings={settings} vscode={vscode} />}
      <PlansCard settings={settings} vscode={vscode} />
      {settings.account && <CreditPacksCard settings={settings} vscode={vscode} />}
    </SettingsSection>
  );
}
