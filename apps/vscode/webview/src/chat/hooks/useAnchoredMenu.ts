import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useAnimatedPresence } from "./useAnimatedPresence.js";

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
const MIN_SPACE_BELOW = 160;

/**
 * Position a menu relative to an anchor, right-aligned, flipping upward when
 * there is not enough room below. Coordinates are in viewport space so the
 * menu can be portaled to `document.body` and escape any `overflow` clipping.
 */
function anchoredStyle(anchor: DOMRect, menuWidth: number): CSSProperties {
  const spaceBelow = window.innerHeight - anchor.bottom - MENU_GAP;
  const spaceAbove = anchor.top - MENU_GAP;
  const openUp = spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow;

  const width = menuWidth || anchor.width;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.right - width, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const maxHeight = Math.max(
    120,
    (openUp ? spaceAbove : spaceBelow) - VIEWPORT_MARGIN,
  );

  const base: CSSProperties = { position: "fixed", left, maxHeight };
  return openUp
    ? { ...base, bottom: window.innerHeight - anchor.top + MENU_GAP, top: "auto" }
    : { ...base, top: anchor.bottom + MENU_GAP, bottom: "auto" };
}

/**
 * Anchored popover menu rendered via a portal. Handles positioning (with
 * upward flip), repositioning on scroll/resize, and dismissal on outside click
 * or Escape. Shared by the History and Plans panels whose menus were clipped by
 * their scroll containers when positioned inline.
 */
export function useAnchoredMenu() {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const presence = useAnimatedPresence(open);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const reposition = () => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = menuRef.current?.offsetWidth ?? 0;
    setMenuStyle(anchoredStyle(anchor, width));
  };

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () =>
    setOpen((v) => {
      const next = !v;
      if (next) requestAnimationFrame(reposition);
      return next;
    });

  return {
    open,
    setOpen,
    toggle,
    buttonRef,
    menuRef,
    menuStyle,
    mounted: presence.mounted,
    closing: presence.closing,
  };
}
