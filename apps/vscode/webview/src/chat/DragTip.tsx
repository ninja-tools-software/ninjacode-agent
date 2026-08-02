import { CloseIcon } from "../icons.js";
import { animCls } from "./hooks/useAnimatedPresence.js";

/**
 * One-shot onboarding hint. VS Code cuts pointer events on webview iframes
 * during a drag, so an Explorer drop only reaches us while Shift is held —
 * a constraint users cannot guess.
 */
export function DragTip({ closing, onDismiss }: { closing?: boolean; onDismiss: () => void }) {
  return (
    <div className={animCls("drag-tip panel-enter", closing && "anim-closing")} role="note">
      <span className="drag-tip-text">
        Tip: hold <kbd>Shift</kbd> while dragging from the Explorer to drop files here.
      </span>
      <button
        type="button"
        className="icon-btn drag-tip-close"
        data-tooltip="Got it"
        aria-label="Dismiss tip"
        onClick={onDismiss}
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}
