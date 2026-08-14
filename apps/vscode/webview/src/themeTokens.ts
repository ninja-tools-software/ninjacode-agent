/** Read design-system CSS variables. Fallbacks keep gauges identical without a DOM. */

export type Rgb = readonly [number, number, number];

let colorProbe: HTMLDivElement | null = null;

function getColorProbe(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (!colorProbe) {
    colorProbe = document.createElement("div");
    colorProbe.setAttribute("aria-hidden", "true");
    colorProbe.style.cssText =
      "position:absolute;left:-9999px;width:1px;height:1px;pointer-events:none;visibility:hidden";
    (document.body ?? document.documentElement).appendChild(colorProbe);
  }
  return colorProbe;
}

function computedToken(name: string): string {
  if (typeof document === "undefined") return "";
  const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (fromRoot) return fromRoot;
  if (!document.body) return "";
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/** Raw custom-property value (`oklch(...)`, `var(...)`, …). */
export function readToken(name: string, fallback: string): string {
  return computedToken(name) || fallback;
}

/** Resolve any CSS color (including `var(--token)`) to the computed `rgb()`. */
export function resolveColor(cssColor: string, fallback: string): string {
  const probe = getColorProbe();
  if (!probe) return fallback;
  probe.style.background = "";
  probe.style.backgroundColor = cssColor;
  const computed = getComputedStyle(probe).backgroundColor.trim();
  if (!computed || computed === "rgba(0, 0, 0, 0)" || computed === "transparent") {
    return fallback;
  }
  return computed;
}

/** Resolve a `--token` color to computed `rgb()`. */
export function readTokenColor(name: string, fallback: string): string {
  return resolveColor(`var(${name}, ${fallback})`, fallback);
}

export function parseCssRgb(input: string): Rgb | null {
  const trimmed = input.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) return parseHexRgb(hex[1]);
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const srgb = trimmed.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (!srgb) return null;
  return [
    Math.round(Number(srgb[1]) * 255),
    Math.round(Number(srgb[2]) * 255),
    Math.round(Number(srgb[3]) * 255),
  ];
}

function parseHexRgb(h: string): Rgb {
  if (h.length === 3 || h.length === 4) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function rgbCss(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function rgbToHex(c: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  return `#${[clamp(c[0]), clamp(c[1]), clamp(c[2])]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function tokenToRgb(name: string, fallback: Rgb): Rgb {
  return parseCssRgb(readTokenColor(name, rgbCss(fallback))) ?? fallback;
}

/** Resolve `color-mix` via a hidden probe; returns computed `rgb()` or `base`. */
export function mixCssColors(base: string, overlay: string, overlayPercent: number): string {
  const probe = getColorProbe();
  if (!probe) return base;
  probe.style.backgroundColor = "";
  probe.style.background = `color-mix(in srgb, ${overlay} ${overlayPercent}%, ${base})`;
  const resolved = getComputedStyle(probe).backgroundColor.trim();
  return resolved && resolved !== "rgba(0, 0, 0, 0)" ? resolved : base;
}
