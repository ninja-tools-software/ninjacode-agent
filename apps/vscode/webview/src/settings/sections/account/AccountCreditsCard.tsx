import { t } from "../../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../../types.js";
import { creditPercent, formatCredits, hasActivePass } from "./accountFormat.js";

export function AccountCreditsCard({
  settings,
  vscode,
}: {
  settings: SettingsState;
  vscode: VsCodeApi;
}) {
  const account = settings.account!;
  const pct = creditPercent(account.credits, account.creditsIncluded);
  const passActive = settings.provider === "gateway";

  return (
    <div className="card card--hero">
      <div className="card__label">{t("Credits remaining")}</div>
      <div className="credit-figure">
        <strong>{formatCredits(account.credits)}</strong>
        {account.creditsIncluded > 0 && (
          <span className="muted">/ {formatCredits(account.creditsIncluded)}</span>
        )}
      </div>
      {account.creditsIncluded > 0 && (
        <div
          className={`credit-gauge ${pct < 15 ? "low" : ""}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={account.creditsIncluded}
          aria-valuenow={Math.round(account.credits)}
        >
          <div className="credit-gauge__fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <dl className="kv">
        <div>
          <dt>{t("Plan")}</dt>
          <dd>{planLabel(account.passTier, account.planKind)}</dd>
        </div>
        <div>
          <dt>{account.cancelAt ? t("Ends") : t("Renews")}</dt>
          <dd>{formatDate(account.cancelAt ?? account.renewsAt)}</dd>
        </div>
        <div>
          <dt>{t("Email")}</dt>
          <dd className="ellipsis">{account.email}</dd>
        </div>
      </dl>
      {account.planKind === "commitment" && account.commitmentEndsAt && (
        <p className="muted">
          {t("12-month commitment ends {0}", new Date(account.commitmentEndsAt).toLocaleDateString())}
        </p>
      )}
      <AccountActions vscode={vscode} account={account} passActive={passActive} />
    </div>
  );
}

function planLabel(tier: string | null, kind: string | null): string {
  if (!hasActivePass(tier)) return t("none");
  if (kind === "commitment") return t("{0} · yearly", tier ?? "");
  if (kind === "monthly") return t("{0} · monthly", tier ?? "");
  return tier ?? t("none");
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function AccountActions({
  vscode,
  account,
  passActive,
}: {
  vscode: VsCodeApi;
  account: NonNullable<SettingsState["account"]>;
  passActive: boolean;
}) {
  const subscribed = hasActivePass(account.passTier);
  return (
    <div className="row account-actions">
      <button className="btn" onClick={() => vscode.postMessage({ type: "account_refresh" })}>
        {t("Refresh")}
      </button>
      {subscribed && (
        <button className="btn" onClick={() => vscode.postMessage({ type: "account_billing_portal" })}>
          {t("Manage billing")}
        </button>
      )}
      {subscribed && account.cancelAt && (
        <button className="btn" onClick={() => vscode.postMessage({ type: "account_resume_subscription" })}>
          {t("Resume Pass")}
        </button>
      )}
      {!passActive && (
        <button
          className="btn primary"
          onClick={() => vscode.postMessage({ type: "update_settings", provider: "gateway" })}
        >
          {t("Use NinjaCode Pass")}
        </button>
      )}
      <button className="btn" onClick={() => vscode.postMessage({ type: "account_logout" })}>
        {t("Sign out")}
      </button>
    </div>
  );
}
