import { useEffect, useState } from "react";
import { t } from "../../i18n.js";
import { CREDIT_PLANS, type SettingsState, type VsCodeApi } from "../../types.js";
import { SettingsSection } from "../SettingsSection.js";

function creditPercent(account: NonNullable<SettingsState["account"]>) {
  if (account.creditsIncluded <= 0) return 0;
  return Math.max(0, Math.min(100, (account.credits / account.creditsIncluded) * 100));
}

function AccountCreditsCard({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  const account = settings.account!;
  const pct = creditPercent(account);

  return (
    <>
      <div className="card card--hero">
        <div className="card__label">{t("Credits remaining")}</div>
        <div className="credit-figure">
          <strong>{Math.round(account.credits).toLocaleString()}</strong>
          {account.creditsIncluded > 0 && (
            <span className="muted">/ {account.creditsIncluded.toLocaleString()}</span>
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
            <dd>{account.passTier ?? t("none")}</dd>
          </div>
          <div>
            <dt>{t("Renews")}</dt>
            <dd>{account.renewsAt ? new Date(account.renewsAt).toLocaleDateString() : "—"}</dd>
          </div>
          <div>
            <dt>{t("Email")}</dt>
            <dd className="ellipsis">{account.email}</dd>
          </div>
        </dl>
        <div className="row">
          <button className="btn" onClick={() => vscode.postMessage({ type: "account_refresh" })}>
            {t("Refresh")}
          </button>
          <button className="btn" onClick={() => vscode.postMessage({ type: "account_logout" })}>
            {t("Sign out")}
          </button>
        </div>
      </div>
      <UsageTable settings={settings} />
    </>
  );
}

function UsageTable({ settings }: { settings: SettingsState }) {
  return (
    <div className="card">
      <div className="card__label">{t("Recent usage")}</div>
      {settings.usage.length === 0 ? (
        <p className="muted">{t("No requests through the gateway yet.")}</p>
      ) : (
        <table className="usage-table">
          <thead>
            <tr>
              <th>{t("Model")}</th>
              <th>{t("Tokens")}</th>
              <th>{t("Credits")}</th>
            </tr>
          </thead>
          <tbody>
            {settings.usage.slice(0, 12).map((u, i) => (
              <tr key={i}>
                <td>
                  <code>{u.model ?? "?"}</code>
                </td>
                <td className="muted">
                  {(u.inputTokens ?? 0).toLocaleString()}/{(u.outputTokens ?? 0).toLocaleString()}
                </td>
                <td>{(u.credits ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AccountLoginCard({ vscode }: { vscode: VsCodeApi }) {
  const [loginEmail, setLoginEmail] = useState("");
  const [pasteKey, setPasteKey] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setTimedOut(true), 90_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  return (
    <div className="card card--hero">
      <div className="card__label">{t("Sign in")}</div>
      <p className="muted">
        {t("Sign in with your browser. If you are already logged in on the website, the extension connects automatically.")}
      </p>
      <div className="row">
        <button
          className="btn primary"
          disabled={waiting}
          onClick={() => {
            setWaiting(true);
            setTimedOut(false);
            vscode.postMessage({ type: "account_browser_login" });
          }}
        >
          {waiting ? t("Waiting for browser…") : t("Sign in with browser")}
        </button>
      </div>
      {waiting && (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          {timedOut
            ? t("Still waiting — finish sign-in in the browser, or use an option below.")
            : t("Complete sign-in in the browser window, then return here.")}
        </p>
      )}

      <details
        className="account-advanced"
        style={{ marginTop: "1.25rem" }}
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="muted" style={{ cursor: "pointer" }}>
          {t("Other sign-in options")}
        </summary>
        <div className="field" style={{ marginTop: "0.75rem" }}>
          <label>{t("Email")}</label>
          <div className="row">
            <input
              type="email"
              value={loginEmail}
              placeholder="you@company.com"
              onChange={(e) => setLoginEmail(e.target.value)}
            />
            <button
              className="btn"
              disabled={!loginEmail.trim()}
              onClick={() => {
                setWaiting(true);
                setTimedOut(false);
                vscode.postMessage({ type: "account_login", email: loginEmail.trim() });
              }}
            >
              {t("Send link")}
            </button>
          </div>
        </div>
        <div className="field">
          <label>{t("Or paste an API key")}</label>
          <div className="row">
            <input
              type="password"
              value={pasteKey}
              placeholder="nk_…"
              onChange={(e) => setPasteKey(e.target.value)}
            />
            <button
              className="btn"
              disabled={!pasteKey.trim()}
              onClick={() => {
                vscode.postMessage({ type: "account_paste_key", key: pasteKey.trim() });
                setPasteKey("");
              }}
            >
              {t("Save")}
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function AccountUpsell({ vscode }: { vscode: VsCodeApi }) {
  return (
    <div className="card card--upsell">
      <div className="card__label">{t("NinjaCode Pass")}</div>
      <p className="muted">
        {t("Predictable monthly credits across every frontier model — no per-provider keys to juggle.")}
      </p>
      <div className="tier-grid">
        {CREDIT_PLANS.map((plan) => (
          <button
            key={plan.id}
            className={`tier-card ${plan.id === "pro" ? "featured" : ""}`}
            onClick={() => vscode.postMessage({ type: "account_subscribe", tier: plan.id })}
          >
            <strong>{t(plan.label)}</strong>
            <span className="tier-price">{t("{0}/mo", plan.price)}</span>
            <span className="tier-credits">{t(plan.credits)}</span>
            {plan.hint && <span className="tier-hint">{t(plan.hint)}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function needsUpsell(account: SettingsState["account"]) {
  return !account?.passTier || account.passTier === "none" || (account.credits ?? 0) <= 0;
}

export function AccountSection({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  return (
    <SettingsSection
      id="account"
      title={t("Account & credits")}
      description={t(
        "One subscription, monthly credits, every frontier model through the NinjaCode gateway.",
      )}
    >
      <div className="settings-grid">
        {settings.account ? (
          <AccountCreditsCard settings={settings} vscode={vscode} />
        ) : (
          <AccountLoginCard vscode={vscode} />
        )}
      </div>
      {needsUpsell(settings.account) && <AccountUpsell vscode={vscode} />}
    </SettingsSection>
  );
}
