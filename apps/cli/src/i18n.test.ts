import { describe, expect, it } from "vitest";
import { normalizeLocale, resolveLocale, setLocale, t } from "./i18n.js";

describe("cli i18n", () => {
  it("normalizes locale prefixes", () => {
    expect(normalizeLocale("fr_FR.UTF-8")).toBe("fr");
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("de")).toBe("en");
  });

  it("prefers --lang over env", () => {
    const prev = process.env.NINJACODE_LANG;
    process.env.NINJACODE_LANG = "en";
    expect(resolveLocale({ lang: "fr" })).toBe("fr");
    if (prev === undefined) delete process.env.NINJACODE_LANG;
    else process.env.NINJACODE_LANG = prev;
  });

  it("translates with params", () => {
    setLocale("fr");
    expect(t("cli.invalidMode", { mode: "foo" })).toContain("foo");
    expect(t("cli.invalidMode", { mode: "foo" })).toMatch(/invalide/i);
    setLocale("en");
    expect(t("cli.missingApiKey")).toMatch(/API key/i);
  });
});
