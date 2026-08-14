import { describe, expect, it } from "vitest";
import { parseCssRgb, readToken, rgbCss, rgbToHex, tokenToRgb } from "./themeTokens.js";

const green = [63, 185, 80] as const;

describe("parseCssRgb", () => {
  it("parses hex, rgb(), and color(srgb …)", () => {
    expect(parseCssRgb("#3fb950")).toEqual(green);
    expect(parseCssRgb("#abc")).toEqual([170, 187, 204]);
    expect(parseCssRgb("rgb(63, 185, 80)")).toEqual(green);
    expect(parseCssRgb("rgba(63, 185, 80, 0.5)")).toEqual(green);
    expect(parseCssRgb("color(srgb 0.0796079 0.114902 0.133333)")).toEqual([20, 29, 34]);
    expect(parseCssRgb("oklch(0.7 0.15 145)")).toBeNull();
  });
});

describe("rgb helpers", () => {
  it("round-trips rgb css and hex", () => {
    expect(rgbCss(green)).toBe("rgb(63, 185, 80)");
    expect(rgbToHex(green)).toBe("#3fb950");
  });
});

describe("readToken / tokenToRgb without a styled document", () => {
  it("returns the fallback", () => {
    expect(readToken("--success", "#3fb950")).toBe("#3fb950");
    expect(tokenToRgb("--success", green)).toEqual(green);
  });
});
