import { AttachIcon, BoltIcon, ChartIcon, WandIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { ShurikenMark } from "../ui/Brand.js";
import { ModeIcon } from "../ui/ModeIcon.js";
import type { OnboardingIconId, OnboardingPoint } from "./onboardingCopy.js";

export function PointIcon({ id }: { id: OnboardingIconId }) {
  switch (id) {
    case "bolt":
      return <BoltIcon size={16} />;
    case "wand":
      return <WandIcon size={16} />;
    case "chart":
      return <ChartIcon size={16} />;
    case "attach":
      return <AttachIcon size={16} />;
    case "modes":
      return <ModeIcon mode="agent" size={16} />;
    case "shuriken":
      return <ShurikenMark id="onboarding-point" size={16} />;
  }
}

export function OnboardingPointItem({ point }: { point: OnboardingPoint }) {
  return (
    <li className="onb-point">
      <span className="onb-point-icon" aria-hidden="true">
        <PointIcon id={point.icon} />
      </span>
      <div className="onb-point-body">
        <strong>{t(point.title)}</strong>
        <p>{t(point.body)}</p>
      </div>
    </li>
  );
}
