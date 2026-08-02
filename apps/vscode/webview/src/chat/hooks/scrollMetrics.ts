/** How far from the bottom still counts as "following the conversation". */
export const NEAR_BOTTOM_PX = 64;

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function isNearBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;
}

/** Keyboard keys that move the viewport upward in a scroll container. */
export function isUpwardKey(key: string): boolean {
  return key === "ArrowUp" || key === "PageUp" || key === "Home";
}

/** Negative deltaY means the user scrolled the wheel toward earlier content. */
export function isUpwardWheel(deltaY: number): boolean {
  return deltaY < 0;
}
