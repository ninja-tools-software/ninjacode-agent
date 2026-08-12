import { t } from "../../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../../types.js";
import { formatCredits, formatEur } from "./accountFormat.js";

export function CreditPacksCard({
  settings,
  vscode,
}: {
  settings: SettingsState;
  vscode: VsCodeApi;
}) {
  const catalog = settings.plans;
  if (!catalog || catalog.packs.length === 0) return null;

  return (
    <div className="card">
      <div className="card__label">{t("Credit packs")}</div>
      <p className="muted">
        {t("One-shot top-ups. Unused credits expire after {0} months.", catalog.packExpiryMonths)}
      </p>
      <div className="tier-grid">
        {catalog.packs.map((pack) => (
          <button
            key={pack.id}
            className="tier-card"
            onClick={() => vscode.postMessage({ type: "account_buy_pack", packId: pack.id })}
          >
            <strong>{pack.label}</strong>
            <span className="tier-price">{formatEur(pack.priceEur)}</span>
            <span className="tier-credits">{t("{0} credits", formatCredits(pack.credits))}</span>
            <span className="tier-cta">{t("Buy pack")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
