import {
  mixCssColors,
  parseCssRgb,
  readToken,
  readTokenColor,
  resolveColor,
  rgbToHex,
} from "./themeTokens.js";

type ThemeKind = "dark" | "light" | "high-contrast";

/** Convert rgb(), rgba(), hex, or color(srgb …) to #rrggbb for Mermaid. */
export function toMermaidColor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "#000000";
  const rgb = parseCssRgb(trimmed);
  if (rgb) return rgbToHex(rgb);
  const computed = resolveColor(trimmed, trimmed);
  if (computed !== trimmed) return toMermaidColor(computed);
  return trimmed;
}

function readCssColor(name: string, fallback: string): string {
  return toMermaidColor(readTokenColor(name, fallback));
}

function mixColors(base: string, overlay: string, overlayPercent: number): string {
  return toMermaidColor(mixCssColors(base, overlay, overlayPercent));
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
  const fontFamily = readToken("--vscode-font-family", "sans-serif");
  const fontSize = readToken("--vscode-font-size", "14px");

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
    font-size: var(--text-lg) !important;
    font-weight: var(--weight-semibold) !important;
  }
  .cluster-label span,
  .cluster-label foreignObject div {
    font-size: var(--text-lg) !important;
    font-weight: var(--weight-semibold) !important;
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
