import { useEffect, useRef, type RefObject } from "react";

/**
 * Close a popover on outside click or Escape. Every menu in the chat used to
 * inline its own copy of this effect; they are all this hook now.
 */
export function useDismiss<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const handler = useRef(onDismiss);
  handler.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return ref;
}
