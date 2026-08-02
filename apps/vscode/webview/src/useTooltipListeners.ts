import { useEffect, useRef, useState } from "react";

const SHOW_DELAY_MS = 120;
export const TOOLTIP_MARGIN = 6;

type TooltipState = {
  text: string;
  /** Desired horizontal center of the tip (anchor midpoint), before width clamp. */
  x: number;
  y: number;
  below: boolean;
} | null;

export function useTooltipListeners(): TooltipState {
  const [tip, setTip] = useState<TooltipState>(null);
  const timerRef = useRef(0);

  useEffect(() => {
    const hide = () => {
      window.clearTimeout(timerRef.current);
      setTip(null);
    };
    const onOver = (e: Event) => {
      const target = (e.target as HTMLElement | null)?.closest?.("[data-tooltip]");
      if (!(target instanceof HTMLElement)) {
        hide();
        return;
      }
      const text = target.dataset.tooltip;
      if (!text) {
        hide();
        return;
      }
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const below = rect.top < 34 + TOOLTIP_MARGIN;
        setTip({
          text,
          x: rect.left + rect.width / 2,
          y: below ? rect.bottom + TOOLTIP_MARGIN : rect.top - TOOLTIP_MARGIN,
          below,
        });
      }, SHOW_DELAY_MS);
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("mouseout", hide, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(timerRef.current);
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("mouseout", hide, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);

  return tip;
}
