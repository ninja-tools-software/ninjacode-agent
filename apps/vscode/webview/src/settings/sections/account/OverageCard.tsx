import { useEffect, useState } from "react";
import { t } from "../../../i18n.js";
import type { SettingsState, VsCodeApi } from "../../../types.js";
import {
  formatCredits,
  formatEur,
  OVERAGE_PRESETS,
  overageConsumedPct,
  overageCreditsFor,
} from "./accountFormat.js";

export function OverageCard({
  settings,
  vscode,
}: {
  settings: SettingsState;
  vscode: VsCodeApi;
}) {
  const overage = settings.account?.overage;
  const creditValueEur = settings.plans?.creditValueEur ?? 0.001;
  const [draft, setDraft] = useState(overage?.limitEur ?? 0);

  useEffect(() => {
    if (overage) setDraft(overage.limitEur);
  }, [overage?.limitEur]);

  if (!overage) return null;

  const pct = overageConsumedPct(overage.consumedCredits, overage.limitCredits);
  const credits = overageCreditsFor(draft, creditValueEur);

  return (
    <div className="card account-overage">
      <div className="card__label">{t("Overage limit")}</div>
      <p className="muted">
        {t("After included credits run out, keep going up to this cap. Billed at the end of the cycle.")}
      </p>
      <div className="overage-row">
        <label className="overage-field">
          <span className="muted">{t("Limit")}</span>
          <input
            type="number"
            min={0}
            max={overage.maxLimitEur}
            step={1}
            value={draft}
            onChange={(e) => setDraft(clampOverage(Number(e.target.value), overage.maxLimitEur))}
          />
          <span className="muted">€</span>
        </label>
        <div className="overage-equiv">
          <span className="muted">{t("Equals")}</span>
          <strong>{formatCredits(credits)}</strong>
          <span className="muted">{t("credits · {0} / credit", formatEur(creditValueEur))}</span>
        </div>
      </div>
      <div className="overage-presets">
        {OVERAGE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`btn ${draft === preset ? "primary" : ""}`}
            onClick={() => setDraft(preset)}
          >
            {preset === 0 ? t("Off") : `${preset} €`}
          </button>
        ))}
      </div>
      {overage.limitCredits > 0 && (
        <>
          <div
            className="credit-gauge"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div className="credit-gauge__fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted">
            {t(
              "{0} credits ({1}) used of {2}",
              formatCredits(overage.consumedCredits),
              formatEur(overage.consumedEur),
              formatCredits(overage.limitCredits),
            )}
          </p>
        </>
      )}
      <button
        className="btn primary"
        onClick={() => vscode.postMessage({ type: "account_set_overage", limitEur: draft })}
      >
        {t("Save overage limit")}
      </button>
    </div>
  );
}

function clampOverage(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(max, Math.round(value));
}
