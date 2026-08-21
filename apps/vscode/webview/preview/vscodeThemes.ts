/**
 * The `--vscode-*` variables a webview inherits from the workbench. Outside VS
 * Code they are simply absent, which leaves `--bg` / `--fg` empty and the chat
 * unreadable, so the preview injects the Dark Modern / Light Modern values.
 *
 * Only the variables actually referenced by `src/styles/*.css` and
 * `src/mermaidTheme.ts` are listed — a missing one is a styling bug we want to
 * see here rather than hide behind an invented value.
 */

export type PreviewThemeId = "dark" | "light";

const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif';
const CODE_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace';

const SHARED: Record<string, string> = {
  "font-family": FONT_FAMILY,
  "font-size": "13px",
  "editor-font-family": CODE_FONT_FAMILY,
  "charts-orange": "#d18616",
};

const DARK: Record<string, string> = {
  "editor-background": "#1f1f1f",
  "editor-foreground": "#cccccc",
  "panel-border": "#2b2b2b",
  "button-background": "#0078d4",
  "button-foreground": "#ffffff",
  descriptionForeground: "#9d9d9d",
  "input-background": "#313131",
  "input-foreground": "#cccccc",
  focusBorder: "#0078d4",
  "list-hoverBackground": "#2a2d2e",
  "list-activeSelectionBackground": "#04395e",
  "editorWidget-background": "#202020",
  "textLink-foreground": "#4daafc",
  "textLink-activeForeground": "#4daafc",
  "testing-iconPassed": "#73c991",
  "charts-yellow": "#d7ba7d",
  errorForeground: "#f85149",
  "badge-background": "#616161",
  "badge-foreground": "#f8f8f8",
  "editorHoverWidget-background": "#202020",
  "editorHoverWidget-foreground": "#cccccc",
  "editorHoverWidget-border": "#454545",
  "editorLineNumber-foreground": "#6e7681",
  "symbolIcon-keywordForeground": "#c586c0",
  "symbolIcon-stringForeground": "#ce9178",
  "symbolIcon-numberForeground": "#b5cea8",
  "symbolIcon-functionForeground": "#b180d7",
  "symbolIcon-classForeground": "#ee9d28",
};

const LIGHT: Record<string, string> = {
  "editor-background": "#ffffff",
  "editor-foreground": "#3b3b3b",
  "panel-border": "#e5e5e5",
  "button-background": "#005fb8",
  "button-foreground": "#ffffff",
  descriptionForeground: "#646464",
  "input-background": "#ffffff",
  "input-foreground": "#3b3b3b",
  focusBorder: "#005fb8",
  "list-hoverBackground": "#f2f2f2",
  "list-activeSelectionBackground": "#e8e8e8",
  "editorWidget-background": "#f8f8f8",
  "textLink-foreground": "#005fb8",
  "textLink-activeForeground": "#005fb8",
  "testing-iconPassed": "#007100",
  "charts-yellow": "#b89500",
  errorForeground: "#e51400",
  "badge-background": "#cccccc",
  "badge-foreground": "#3b3b3b",
  "editorHoverWidget-background": "#f8f8f8",
  "editorHoverWidget-foreground": "#3b3b3b",
  "editorHoverWidget-border": "#c8c8c8",
  "editorLineNumber-foreground": "#6e7681",
  "symbolIcon-keywordForeground": "#af00db",
  "symbolIcon-stringForeground": "#a31515",
  "symbolIcon-numberForeground": "#098658",
  "symbolIcon-functionForeground": "#652d90",
  "symbolIcon-classForeground": "#d67e00",
};

const THEMES: Record<PreviewThemeId, Record<string, string>> = { dark: DARK, light: LIGHT };

/** Workbench body class the product CSS keys off (`body.vscode-light`). */
const BODY_CLASSES: Record<PreviewThemeId, string> = {
  dark: "vscode-dark",
  light: "vscode-light",
};

export function applyPreviewTheme(theme: PreviewThemeId): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries({ ...SHARED, ...THEMES[theme] })) {
    root.style.setProperty(`--vscode-${name}`, value);
  }
  document.body.classList.remove(...Object.values(BODY_CLASSES));
  document.body.classList.add(BODY_CLASSES[theme]);
  root.style.colorScheme = theme;
}
