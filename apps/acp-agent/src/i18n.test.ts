import { describe, expect, it } from "vitest";
import { normalizeLocale, t } from "./i18n.js";
import { initLocale } from "./i18n.js";

describe("acp i18n", () => {
  it("normalizes locale", () => {
    expect(normalizeLocale("fr-CA")).toBe("fr");
    expect(normalizeLocale(undefined)).toBe("en");
  });

  it("translates after init", () => {
    process.env.NINJACODE_LANG = "fr";
    initLocale();
    expect(t("acp.unknownSession")).toMatch(/Session inconnue/);
    process.env.NINJACODE_LANG = "en";
    initLocale();
    expect(t("acp.unknownSession")).toBe("Unknown session");
  });
});
