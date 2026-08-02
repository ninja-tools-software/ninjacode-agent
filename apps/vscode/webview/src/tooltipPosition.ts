/** Keep a center-anchored tooltip fully inside the viewport horizontally. */
export function clampTooltipCenterX(
  anchorCenterX: number,
  tipWidth: number,
  viewportWidth: number,
  margin: number,
): number {
  const half = tipWidth / 2;
  const min = margin + half;
  const max = viewportWidth - margin - half;
  if (min >= max) return viewportWidth / 2;
  return Math.min(Math.max(anchorCenterX, min), max);
}
