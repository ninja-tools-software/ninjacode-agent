import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { isNearBottom, isUpwardKey, isUpwardWheel } from "./scrollMetrics.js";

type SetFollowing = (following: boolean) => void;

/** Wire user-intent listeners that unstick, and scroll that re-sticks near bottom. */
function bindScrollIntent(
  el: HTMLElement,
  programmaticRef: MutableRefObject<boolean>,
  touchYRef: MutableRefObject<number | null>,
  setFollowing: SetFollowing,
): () => void {
  const onScroll = () => {
    if (programmaticRef.current) return;
    if (isNearBottom(el)) setFollowing(true);
  };
  const onWheel = (e: WheelEvent) => {
    if (isUpwardWheel(e.deltaY)) setFollowing(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (isUpwardKey(e.key)) setFollowing(false);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (e.offsetX > el.clientWidth) setFollowing(false);
  };
  const onTouchStart = (e: TouchEvent) => {
    touchYRef.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: TouchEvent) => {
    const y = e.touches[0]?.clientY;
    if (y == null || touchYRef.current == null) return;
    if (y - touchYRef.current > 0) setFollowing(false);
    touchYRef.current = y;
  };

  el.addEventListener("scroll", onScroll, { passive: true });
  el.addEventListener("wheel", onWheel, { passive: true });
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: true });
  return () => {
    el.removeEventListener("scroll", onScroll);
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
  };
}

/**
 * Keep the log pinned to the bottom while new content grows, unless the user
 * scrolled up to read — then leave them where they are until they come back
 * down (or click the jump-to-bottom control). Height is watched via
 * ResizeObserver so plan cards, todos, and async renders (Mermaid, images)
 * reposition without depending on `state.log`.
 *
 * Programmatic scrolls are gated so their own `scroll` events never unstick us;
 * follow always uses `behavior: "auto"` to avoid the intermediate positions
 * that a smooth animation would feed into the near-bottom check.
 */
export function useAutoScroll() {
  const logRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const programmaticRef = useRef(false);
  const touchYRef = useRef<number | null>(null);
  const [stuck, setStuck] = useState(true);
  const [hasNewContent, setHasNewContent] = useState(false);

  const setFollowing = useCallback((following: boolean) => {
    stickRef.current = following;
    setStuck((prev) => (prev === following ? prev : following));
    if (following) setHasNewContent((prev) => (prev ? false : prev));
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = logRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior });
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  const stickToBottom = useCallback(() => {
    setFollowing(true);
  }, [setFollowing]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    return bindScrollIntent(el, programmaticRef, touchYRef, setFollowing);
  }, [setFollowing]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        scrollToBottom("auto");
        return;
      }
      setHasNewContent((prev) => (prev ? prev : true));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  return { logRef, contentRef, stuck, hasNewContent, scrollToBottom, stickToBottom };
}
