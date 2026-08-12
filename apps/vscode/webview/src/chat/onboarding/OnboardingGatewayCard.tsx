import { t } from "../../i18n.js";
import type { VsCodeApi } from "../types.js";
import { GATEWAY_BENEFITS } from "./onboardingCopy.js";
import { OnboardingPointItem } from "./OnboardingPointItem.js";

export function OnboardingGatewayCard({ vscode }: { vscode: VsCodeApi }) {
  return (
    <section className="onb-card onb-pass" aria-labelledby="onb-pass-title">
      <div className="onb-pass-head">
        <span className="onb-badge">{t("NinjaCode Pass")}</span>
        <h3 id="onb-pass-title">{t("One subscription. Every frontier model.")}</h3>
      </div>

      <ul className="onb-points">
        {GATEWAY_BENEFITS.map((point) => (
          <OnboardingPointItem key={point.title} point={point} />
        ))}
      </ul>

      <div className="onb-actions">
        <button
          type="button"
          className="btn primary onb-cta"
          onClick={() => vscode.postMessage({ type: "gateway_open_web", page: "signup" })}
        >
          {t("Create an account")}
        </button>
        <button
          type="button"
          className="btn onb-cta"
          onClick={() => vscode.postMessage({ type: "gateway_sign_in" })}
        >
          {t("Sign in")}
        </button>
      </div>

      <p className="onb-fineprint">
        {t("Opens in your browser.")}{" "}
        <button
          type="button"
          className="onb-link"
          onClick={() => vscode.postMessage({ type: "gateway_open_web", page: "pricing" })}
        >
          {t("See plans and pricing")}
        </button>
      </p>
    </section>
  );
}
