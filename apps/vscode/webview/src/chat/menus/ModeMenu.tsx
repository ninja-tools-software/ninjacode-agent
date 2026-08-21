import { useState } from "react";
import { CheckIcon, ChevronDownIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { animCls, useAnimatedPresence } from "../hooks/useAnimatedPresence.js";
import { useDismiss } from "../hooks/useDismiss.js";
import { MODE_META, modeMeta } from "../modes.js";
import type { Mode } from "../types.js";
import { ModeIcon } from "../ui/ModeIcon.js";

function ModeMenuDropdown({
  mode,
  closing,
  onSelect,
}: {
  mode: Mode;
  closing: boolean;
  onSelect: (next: Mode) => void;
}) {
  return (
    <div
      className={animCls("mode-menu anim-pop anim-pop-origin-bottom", closing && "anim-closing")}
      role="listbox"
      aria-label={t("Mode")}
    >
      {MODE_META.map(({ id, label, hint }) => (
        <button
          key={id}
          type="button"
          role="option"
          aria-selected={id === mode}
          className={`mode-menu-item mode-${id}${id === mode ? " selected" : ""}`}
          onClick={() => onSelect(id)}
        >
          <span className="mode-menu-item-icon">
            <ModeIcon mode={id} size={16} />
          </span>
          <span className="mode-menu-item-main">
            <span className="mode-menu-item-label">{t(label)}</span>
            <span className="mode-menu-item-hint">{t(hint)}</span>
          </span>
          <span className="mode-menu-item-check">{id === mode && <CheckIcon size={12} />}</span>
        </button>
      ))}
    </div>
  );
}

function ModeMenuTrigger({
  mode,
  open,
  onToggle,
}: {
  mode: Mode;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = modeMeta(mode);
  return (
    <button
      type="button"
      className={`composer-pill mode-pill mode-${mode}`}
      data-tooltip={`${t(meta.hint)} · Shift+Tab`}
      aria-label={t(meta.label)}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="mode-pill-leading">
        <ModeIcon mode={mode} size={14} />
        <span className="mode-pill-label">{t(meta.label)}</span>
      </span>
      <ChevronDownIcon size={12} />
    </button>
  );
}

export function ModeMenu({
  mode,
  setMode,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuPresence = useAnimatedPresence(open);
  const rootRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  const selectMode = (next: Mode) => {
    setMode(next);
    setOpen(false);
  };

  return (
    <div className="mode-menu-wrap" ref={rootRef}>
      {menuPresence.mounted && (
        <ModeMenuDropdown mode={mode} closing={menuPresence.closing} onSelect={selectMode} />
      )}
      <ModeMenuTrigger mode={mode} open={open} onToggle={() => setOpen((v) => !v)} />
    </div>
  );
}
