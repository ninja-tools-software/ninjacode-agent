import { SettingsIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { ShurikenMark } from "../ui/Brand.js";
import type { VsCodeApi } from "../types.js";
import { OnboardingGatewayCard } from "./OnboardingGatewayCard.js";
import { OnboardingHowItWorks } from "./OnboardingHowItWorks.js";

function OnboardingHero() {
  return (
    <header className="onb-hero">
      <div className="onb-mark">
        <ShurikenMark id="onboarding" size={30} />
      </div>
      <h2>{t("The open coding agent with one simple plan")}</h2>
      <p>{t("It reads your code, plans, edits and runs your tests.")}</p>
    </header>
  );
}

function OnboardingByok({ vscode }: { vscode: VsCodeApi }) {
  return (
    <p className="onb-byok">
      {t("Own API keys?")}{" "}
      <button
        type="button"
        className="onb-link"
        onClick={() => vscode.postMessage({ type: "open_settings" })}
      >
        <SettingsIcon size={12} />
        {t("Add them in the settings panel")}
      </button>{" "}
      {t("— the gear icon, top right.")}
    </p>
  );
}

/** Takes over the chat body until the user has some way to reach a model. */
export function Onboarding({ vscode, onSkip }: { vscode: VsCodeApi; onSkip: () => void }) {
  return (
    <div className="onb panel-enter">
      <div className="onb-scroll">
        <OnboardingHero />
        <OnboardingGatewayCard vscode={vscode} />
        <OnboardingHowItWorks />
        <OnboardingByok vscode={vscode} />
        <div className="onb-skip">
          <button type="button" className="onb-link" onClick={onSkip}>
            {t("Continue without an account")}
          </button>
        </div>
      </div>
    </div>
  );
}
