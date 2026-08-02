import * as vscode from "vscode";
import frBundle from "../l10n/bundle.l10n.fr.json";

export type UiLocale = "en" | "fr";
export type LocaleSetting = "auto" | "en" | "fr";

const frMessages = frBundle as Record<string, string>;

/** Raw `ninjacode.locale` preference (auto / en / fr). */
export function resolveLocaleSetting(): LocaleSetting {
  const configured = vscode.workspace
    .getConfiguration("ninjacode")
    .get<string>("locale", "auto");
  if (configured === "en" || configured === "fr" || configured === "auto") return configured;
  return "auto";
}

/** Resolve the effective UI locale from `ninjacode.locale` (auto → VS Code display language). */
export function resolveEffectiveLocale(): UiLocale {
  const configured = resolveLocaleSetting();
  if (configured === "en" || configured === "fr") return configured;
  const lang = (vscode.env.language || "en").toLowerCase();
  return lang.startsWith("fr") ? "fr" : "en";
}

function format(template: string, args: Array<string | number | boolean>): string {
  return template.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
}

/**
 * Translate a host UI string. Honours `ninjacode.locale` (not only VS Code's
 * display language) by looking up `l10n/bundle.l10n.fr.json` when effective
 * locale is French; otherwise keeps the English source message.
 */
export function t(message: string, ...args: Array<string | number | boolean>): string {
  const locale = resolveEffectiveLocale();
  if (locale === "fr") {
    const translated = frMessages[message];
    if (translated !== undefined) return format(translated, args);
  }
  return vscode.l10n.t(message, ...args);
}
