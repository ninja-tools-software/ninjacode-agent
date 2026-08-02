import { PlanIcon } from "../icons.js";
import { t } from "../i18n.js";

export function PlansToggleButton({
  plansOpen,
  plansLoading,
  onToggle,
}: {
  plansOpen: boolean;
  plansLoading: boolean;
  onToggle: () => void;
}) {
  const label = plansOpen ? t("Hide plans") : t("Show plans");
  return (
    <button
      type="button"
      className={`icon-btn plans-toggle${plansOpen ? " active" : ""}`}
      data-tooltip={label}
      aria-label={label}
      aria-expanded={plansOpen}
      disabled={plansLoading}
      onClick={onToggle}
    >
      <PlanIcon size={20} />
    </button>
  );
}
