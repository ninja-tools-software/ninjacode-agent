import { useLayoutEffect, useRef, useState } from "react";
import { clampTooltipCenterX } from "./tooltipPosition.js";
import { TOOLTIP_MARGIN, useTooltipListeners } from "./useTooltipListeners.js";

/**
 * Single app-wide tooltip driven by event delegation on `[data-tooltip]`.
 * Rendered `position: fixed` so it is never clipped by scroll containers
 * (`#log`, `.history-list`, …); flips below the anchor when there is no room
 * above, and shifts horizontally so the bubble stays inside the viewport.
 * Buttons keep an `aria-label` for accessibility since the native
 * `title` attribute is not used (it would show a duplicate tooltip).
 */
export function GlobalTooltip() {
  const tip = useTooltipListeners();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!tip) {
      setLeft(null);
      return;
    }
    const el = bubbleRef.current;
    if (!el) return;
    setLeft(clampTooltipCenterX(tip.x, el.offsetWidth, window.innerWidth, TOOLTIP_MARGIN));
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={bubbleRef}
      className={`tooltip-bubble ${tip.below ? "below" : "above"}`}
      style={{ left: left ?? tip.x, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
