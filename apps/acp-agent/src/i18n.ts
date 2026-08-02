import en from "./locales/en.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };

export type AcpLocale = "en" | "fr";

type Catalog = Record<string, string>;

const catalogs: Record<AcpLocale, Catalog> = { en, fr };

let active: AcpLocale = "en";

export function normalizeLocale(value: string | undefined | null): AcpLocale {
  if (!value) return "en";
  const base = value.toLowerCase().replace(/_/g, "-").split("-")[0];
  return base === "fr" ? "fr" : "en";
}

export function resolveLocale(): AcpLocale {
  return normalizeLocale(process.env.NINJACODE_LANG ?? process.env.LC_ALL ?? process.env.LANG);
}

export function initLocale(): void {
  active = resolveLocale();
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
