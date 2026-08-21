/**
 * The preview's own toolbar: scenario, theme, sidebar width, locale. Its labels
 * stay in English — it is a dev tool, not a product surface, so it is out of
 * scope for i18n.
 *
 * Choices are persisted so editing CSS and reloading keeps the same setup.
 */
import type { UiLocale } from "./mockHost.js";
import { SCENARIOS, DEFAULT_SCENARIO_ID } from "./scenarios/index.js";
import { applyPreviewTheme, type PreviewThemeId } from "./vscodeThemes.js";

export type FrameWidth = "320" | "380" | "480" | "full";

export interface PreviewPrefs {
  scenario: string;
  theme: PreviewThemeId;
  width: FrameWidth;
  locale: UiLocale;
}

export interface ChromeCallbacks {
  onScenario: (id: string) => void;
  onLocale: (locale: UiLocale) => void;
  onReplay: () => void;
}

const PREFS_KEY = "ninjacode-preview-prefs";

const DEFAULTS: PreviewPrefs = {
  scenario: DEFAULT_SCENARIO_ID,
  theme: "dark",
  width: "380",
  locale: "en",
};

export function readPrefs(): PreviewPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PreviewPrefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(prefs: PreviewPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private browsing: the toolbar just resets on reload */
  }
}

function applyFrameWidth(width: FrameWidth): void {
  document.documentElement.style.setProperty(
    "--pv-frame-width",
    width === "full" ? "100%" : `${width}px`,
  );
}

function select(id: string): HTMLSelectElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`preview: missing <select id="${id}">`);
  return el;
}

function fillScenarios(el: HTMLSelectElement): void {
  for (const scenario of SCENARIOS) {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.label;
    el.append(option);
  }
}

export interface PreviewChrome {
  /** Echo the last message the UI sent, so dead buttons are visible. */
  showOutbound: (type: string) => void;
}

export function mountPreviewChrome(prefs: PreviewPrefs, cb: ChromeCallbacks): PreviewChrome {
  const current = { ...prefs };
  const scenarioEl = select("preview-scenario");
  const themeEl = select("preview-theme");
  const widthEl = select("preview-width");
  const localeEl = select("preview-locale");

  fillScenarios(scenarioEl);
  scenarioEl.value = current.scenario;
  themeEl.value = current.theme;
  widthEl.value = current.width;
  localeEl.value = current.locale;
  applyFrameWidth(current.width);

  const persist = () => writePrefs(current);

  scenarioEl.addEventListener("change", () => {
    current.scenario = scenarioEl.value;
    persist();
    cb.onScenario(current.scenario);
  });
  themeEl.addEventListener("change", () => {
    current.theme = themeEl.value as PreviewThemeId;
    persist();
    applyPreviewTheme(current.theme);
  });
  widthEl.addEventListener("change", () => {
    current.width = widthEl.value as FrameWidth;
    persist();
    applyFrameWidth(current.width);
  });
  localeEl.addEventListener("change", () => {
    current.locale = localeEl.value as UiLocale;
    persist();
    cb.onLocale(current.locale);
  });
  document.getElementById("preview-replay")?.addEventListener("click", () => cb.onReplay());

  const outbound = document.getElementById("preview-outbound");
  let count = 0;
  return {
    showOutbound: (type) => {
      count += 1;
      if (outbound) outbound.textContent = `→ ${type} (${count})`;
    },
  };
}
