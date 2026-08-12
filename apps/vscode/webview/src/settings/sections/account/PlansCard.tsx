import { useState } from "react";
import { t } from "../../../i18n.js";
import type { PlanKind } from "../../../types.js";
import type { SettingsState, VsCodeApi } from "../../../types.js";
import {
  commitmentTotal,
  displayPrice,
  formatCredits,
  formatEur,
  hasActivePass,
} from "./accountFormat.js";

export function PlansCard({ settings, vscode }: { settings: SettingsState; vscode: VsCodeApi }) {
  const catalog = settings.plans;
  const [kind, setKind] = useState<PlanKind>("monthly");
  if (!catalog || catalog.plans.length === 0) {
    return (
      <div className="card card--upsell">
        <div className="card__label">{t("NinjaCode Pass")}</div>
        <p className="muted">{t("Could not load plans from the gateway. Refresh to try again.")}</p>
      </div>
    );
  }

  const subscribed = hasActivePass(settings.account?.passTier);
  const showKindToggle = !subscribed;

  return (
    <div className="card card--upsell">
      <div className="card__label">{t("NinjaCode Pass")}</div>
      <p className="muted">
        {t("Predictable monthly credits across every frontier model — no per-provider keys to juggle.")}
      </p>
      {showKindToggle && (
        <div className="plan-kind-toggle">
          <button
            type="button"
            className={`btn ${kind === "monthly" ? "primary" : ""}`}
            onClick={() => setKind("monthly")}
          >
            {t("Monthly")}
          </button>
          <button
            type="button"
            className={`btn ${kind === "commitment" ? "primary" : ""}`}
            onClick={() => setKind("commitment")}
          >
            {t("12-month commitment")}
          </button>
        </div>
      )}
      <div className="tier-grid">
        {catalog.plans.map((plan) => {
          const current = settings.account?.passTier === plan.tier;
          return (
            <button
              key={plan.tier}
              className={`tier-card ${plan.highlight ? "featured" : ""} ${current ? "current" : ""}`}
              disabled={current}
              onClick={() =>
                vscode.postMessage({ type: "account_subscribe", tier: plan.tier, planKind: kind })
              }
            >
              <strong>{plan.label}</strong>
              <span className="tier-price">
                {t("{0}/mo", formatEur(displayPrice(plan, kind)))}
              </span>
              {kind === "commitment" && (
                <span className="tier-hint">{t("{0} billed yearly", formatEur(commitmentTotal(plan)))}</span>
              )}
              <span className="tier-credits">
                {t("{0} credits/mo", formatCredits(plan.monthlyCredits))}
              </span>
              {plan.bonusPct > 0 && (
                <span className="tier-hint">{t("+{0}% bonus", Math.round(plan.bonusPct * 100))}</span>
              )}
              <span className="tier-cta">
                {current ? t("Current plan") : subscribed ? t("Change plan") : t("Subscribe")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
