type ThemeKind = "dark" | "light" | "high-contrast";

let colorProbe: HTMLDivElement | null = null;

function getColorProbe(): HTMLDivElement {
  if (!colorProbe && typeof document !== "undefined") {
    colorProbe = document.createElement("div");
    colorProbe.setAttribute("aria-hidden", "true");
    colorProbe.style.cssText =
      "position:absolute;left:-9999px;width:1px;height:1px;pointer-events:none;visibility:hidden";
    document.body.appendChild(colorProbe);
  }
  return colorProbe!;
}

/** Convert rgb(), rgba(), or color(srgb …) to #rrggbb for Mermaid. */
export function toMermaidColor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "#000000";
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed.slice(0, 7);
  }

  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));

  const srgb = trimmed.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (srgb) {
    return rgbToHex(
      Math.round(Number(srgb[1]) * 255),
      Math.round(Number(srgb[2]) * 255),
      Math.round(Number(srgb[3]) * 255),
    );
  }

  if (typeof document === "undefined") return trimmed;

  const probe = getColorProbe();
  probe.style.backgroundColor = trimmed;
  const computed = getComputedStyle(probe).backgroundColor.trim();
  if (computed && computed !== trimmed) return toMermaidColor(computed);

  return trimmed;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

function readCssColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return toMermaidColor(fallback);
  const probe = getColorProbe();
  probe.style.backgroundColor = `var(${name}, ${fallback})`;
  const computed = getComputedStyle(probe).backgroundColor.trim();
  return toMermaidColor(computed || fallback);
}

function readCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

/** Resolve a CSS color-mix expression via a hidden probe element. */
function mixColors(base: string, overlay: string, overlayPercent: number): string {
  if (typeof document === "undefined") return toMermaidColor(base);
  const probe = getColorProbe();
  probe.style.background = `color-mix(in srgb, ${overlay} ${overlayPercent}%, ${base})`;
  const resolved = getComputedStyle(probe).backgroundColor.trim();
  return toMermaidColor(resolved && resolved !== "rgba(0, 0, 0, 0)" ? resolved : base);
}

function getThemeKind(): ThemeKind {
  if (typeof document === "undefined") return "dark";
  const kind = document.body.dataset.vscodeThemeKind;
  if (kind === "light" || kind === "high-contrast") return kind;
  return "dark";
}

/** Map VS Code CSS variables to Mermaid `base` theme variables. */
function resolveMermaidThemeVariables(): Record<string, string> {
  const editorBg = readCssColor("--vscode-editor-background", "#1e1e1e");
  const editorFg = readCssColor("--vscode-editor-foreground", "#cccccc");
  const accent = readCssColor("--vscode-button-background", "#0e639c");
  const border = readCssColor("--vscode-panel-border", "#444444");
  const muted = readCssColor("--vscode-descriptionForeground", "#999999");
  const widgetBg = readCssColor("--vscode-editorWidget-background", editorBg);
  const fontFamily = readCssVar("--vscode-font-family", "sans-serif");
  const fontSize = readCssVar("--vscode-font-size", "14px");

  const isDark = getThemeKind() !== "light";
  const nodeBkg = mixColors(editorBg, accent, isDark ? 12 : 8);
  const primaryColor = mixColors(editorBg, accent, isDark ? 18 : 12);
  const clusterBkg = mixColors(widgetBg, editorFg, isDark ? 6 : 4);

  return {
    background: editorBg,
    mainBkg: nodeBkg,
    nodeBkg,
    primaryColor,
    primaryTextColor: editorFg,
    primaryBorderColor: border,
    secondaryColor: mixColors(editorBg, accent, isDark ? 10 : 6),
    tertiaryColor: mixColors(editorBg, editorFg, isDark ? 8 : 5),
    textColor: editorFg,
    nodeTextColor: editorFg,
    titleColor: editorFg,
    lineColor: muted,
    arrowheadColor: muted,
    defaultLinkColor: muted,
    nodeBorder: border,
    clusterBkg,
    clusterBorder: border,
    edgeLabelBackground: editorBg,
    fontFamily,
    fontSize,
  };
}

type ThemeListener = () => void;
const themeListeners = new Set<ThemeListener>();
let themeObserver: MutationObserver | null = null;

function ensureThemeObserver(): void {
  if (themeObserver || typeof document === "undefined") return;

  themeObserver = new MutationObserver(() => {
    for (const listener of themeListeners) listener();
  });

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-vscode-theme-kind", "style"],
  });
}

/** Subscribe to VS Code editor theme changes (CSS variables / data-vscode-theme-kind). */
export function onEditorThemeChange(listener: ThemeListener): () => void {
  themeListeners.add(listener);
  ensureThemeObserver();
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0 && themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
  };
}

/** Spacing between subgraph box edge, title, and inner nodes. */
const MERMAID_SUBGRAPH_TITLE_MARGIN = { top: 10, bottom: 18 } as const;

const MERMAID_CLUSTER_TITLE_CSS = `
  .cluster-label text {
    font-size: 15px !important;
    font-weight: 600 !important;
  }
  .cluster-label span,
  .cluster-label foreignObject div {
    font-size: 15px !important;
    font-weight: 600 !important;
  }
  .cluster-label foreignObject p {
    margin: 0;
  }
`.trim();

let lastMermaidInitKey = "";

export function initializeMermaidTheme(mermaid: {
  initialize: (config: Record<string, unknown>) => void;
}): void {
  const themeVariables = resolveMermaidThemeVariables();
  const initKey = JSON.stringify(themeVariables);
  if (initKey === lastMermaidInitKey) return;
  lastMermaidInitKey = initKey;

  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    suppressErrorRendering: true,
    themeVariables,
    themeCSS: MERMAID_CLUSTER_TITLE_CSS,
    fontFamily: themeVariables.fontFamily,
    flowchart: {
      subGraphTitleMargin: { ...MERMAID_SUBGRAPH_TITLE_MARGIN },
    },
  });
}
