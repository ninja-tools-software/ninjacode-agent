import { t } from "../i18n.js";
import { animCls } from "./hooks/useAnimatedPresence.js";
import type { RunState } from "./types.js";

export function RunPill({
  runState,
  closing,
  mounted,
  onStop,
}: {
  runState: RunState;
  closing: boolean;
  mounted: boolean;
  onStop: () => void;
}) {
  if (!mounted) return null;
  return (
    <div
      className={animCls(`run-pill run-${runState} panel-enter`, closing && "anim-closing")}
    >
      <span className="run-pill-dot" aria-hidden="true" />
      <span className="run-pill-label">
        {runState === "waiting"
          ? t("Waiting for approval")
          : runState === "stopping"
            ? t("Stopping…")
            : t("Running")}
      </span>
      <button
        className="run-pill-stop"
        data-tooltip={t("Stop the current agent run (Esc)")}
        onClick={onStop}
      >
        {t("Stop")}
      </button>
    </div>
  );
}
