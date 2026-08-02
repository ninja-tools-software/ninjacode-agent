import * as l10n from "@vscode/l10n";
import en from "./i18n/bundle.l10n.json";
import fr from "./i18n/bundle.l10n.fr.json";

export type UiLocale = "en" | "fr";

export function normalizeLocale(locale: string): UiLocale {
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function initL10n(locale: string): void {
  const lang = normalizeLocale(locale);
  const contents = lang === "fr" ? fr : en;
  void l10n.config({ contents: JSON.stringify(contents) });
}

export function t(message: string, ...args: Array<string | number | boolean>): string {
  return l10n.t(message, ...args);
}

/** Apply locale to l10n + document, returning the normalized value for React state. */
export function applyDocumentLocale(locale: string): UiLocale {
  const lang = normalizeLocale(locale);
  initL10n(lang);
  document.body.dataset.locale = lang;
  document.documentElement.lang = lang;
  return lang;
}
