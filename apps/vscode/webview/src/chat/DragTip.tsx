import { CloseIcon } from "../icons.js";
import { t } from "../i18n.js";
import { animCls } from "./hooks/useAnimatedPresence.js";

export function DragTip({ closing, onDismiss }: { closing?: boolean; onDismiss: () => void }) {
  const tip = t("Tip: hold Shift while dragging from the Explorer to drop files here.");
  const key = "Shift";
  const idx = tip.indexOf(key);
  return (
    <div className={animCls("drag-tip panel-enter", closing && "anim-closing")} role="note">
      <span className="drag-tip-text">
        {idx < 0 ? (
          tip
        ) : (
          <>
            {tip.slice(0, idx)}
            <kbd>{key}</kbd>
            {tip.slice(idx + key.length)}
          </>
        )}
      </span>
      <button
        type="button"
        className="icon-btn icon-btn--sm drag-tip-close"
        data-tooltip={t("Got it")}
        aria-label={t("Dismiss tip")}
        onClick={onDismiss}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
