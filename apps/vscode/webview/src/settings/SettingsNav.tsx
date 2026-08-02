import { SECTIONS, type SectionId } from "./constants.js";
import { t } from "../i18n.js";

export function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav className="settings-nav" aria-label={t("Settings sections")}>
      {SECTIONS.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            className={`settings-nav__item ${active === s.id ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <Icon size={14} />
            <span>{t(s.label)}</span>
          </button>
        );
      })}
    </nav>
  );
}
