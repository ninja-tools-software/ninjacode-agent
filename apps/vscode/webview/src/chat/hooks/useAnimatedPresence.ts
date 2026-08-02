import { useEffect, useRef, useState } from "react";

const ANIM_MS = 140;

/** Keep an element mounted for the length of its exit animation. */
export function useAnimatedPresence(open: boolean, ms = ANIM_MS): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const id = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => window.clearTimeout(id);
  }, [open, mounted, ms]);

  return { mounted, closing };
}

/** Same, but freezes the last value so the exit animation doesn't render empty content. */
export function useAnimatedPresenceWithSnapshot<T>(
  open: boolean,
  snapshot: T,
  ms = ANIM_MS,
): { mounted: boolean; closing: boolean; value: T } {
  const ref = useRef(snapshot);
  if (open) ref.current = snapshot;
  const presence = useAnimatedPresence(open, ms);
  return { ...presence, value: ref.current };
}

/** Join conditional class names. */
export function animCls(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
