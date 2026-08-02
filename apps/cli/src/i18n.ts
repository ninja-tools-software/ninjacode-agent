import en from "./locales/en.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };

export type CliLocale = "en" | "fr";

type Catalog = Record<string, string>;

const catalogs: Record<CliLocale, Catalog> = { en, fr };

let active: CliLocale = "en";

export function normalizeLocale(value: string | undefined | null): CliLocale {
  if (!value) return "en";
  const base = value.toLowerCase().replace(/_/g, "-").split("-")[0];
  return base === "fr" ? "fr" : "en";
}

/** Resolve locale: --lang > NINJACODE_LANG > LANG/LC_ALL > en. */
export function resolveLocale(flags?: Record<string, string | boolean>): CliLocale {
  const fromFlag = typeof flags?.lang === "string" ? flags.lang : undefined;
  const fromEnv = process.env.NINJACODE_LANG ?? process.env.LC_ALL ?? process.env.LANG;
  return normalizeLocale(fromFlag ?? fromEnv);
}

export function setLocale(locale: CliLocale): void {
  active = locale;
}

export function getLocale(): CliLocale {
  return active;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const catalog = catalogs[active] ?? catalogs.en;
  let text = catalog[key] ?? catalogs.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
