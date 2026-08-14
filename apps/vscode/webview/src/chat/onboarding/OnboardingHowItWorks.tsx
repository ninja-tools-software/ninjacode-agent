import { t } from "../../i18n.js";
import { MODE_META } from "../modes.js";
import { ModeIcon } from "../ui/ModeIcon.js";
import { AGENT_BASICS, chatToggleShortcut } from "./onboardingCopy.js";
import { PointIcon } from "./OnboardingPointItem.js";

function ModeChips() {
  return (
    <ul className="onb-modes">
      {MODE_META.map(({ id, label, hint }) => (
        <li key={id} className={`onb-mode mode-${id}`}>
          <span className="onb-mode-icon">
            <ModeIcon mode={id} size={12} />
          </span>
          <strong>{t(label)}</strong>
          <span className="onb-mode-hint">{t(hint)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Secondary block: one scannable line per basic, so the pitch above stays the focus. */
export function OnboardingHowItWorks() {
  const shortcut = chatToggleShortcut(navigator.platform);
  return (
    <section className="onb-card onb-basics" aria-labelledby="onb-basics-title">
      <h3 id="onb-basics-title" className="onb-card-title">
        {t("How NinjaCode works")}
      </h3>
      <ul className="onb-lines">
        {AGENT_BASICS.map((line) => (
          <li key={line.text} className="onb-line">
            <span className="onb-line-icon" aria-hidden="true">
              <PointIcon id={line.icon} />
            </span>
            <div className="onb-line-body">
              <span>{t(line.text, shortcut)}</span>
              {line.icon === "modes" && <ModeChips />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
