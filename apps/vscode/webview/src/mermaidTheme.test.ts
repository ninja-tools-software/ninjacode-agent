import { describe, expect, it } from "vitest";
import { toMermaidColor } from "./mermaidTheme.js";

describe("toMermaidColor", () => {
  it("passes through hex colors", () => {
    expect(toMermaidColor("#1e1e1e")).toBe("#1e1e1e");
    expect(toMermaidColor("#abc")).toBe("#aabbcc");
  });

  it("converts rgb()", () => {
    expect(toMermaidColor("rgb(30, 30, 30)")).toBe("#1e1e1e");
    expect(toMermaidColor("rgba(204, 204, 204, 0.5)")).toBe("#cccccc");
  });

  it("converts color(srgb …)", () => {
    expect(toMermaidColor("color(srgb 0.0796079 0.114902 0.133333)")).toBe("#141d22");
  });
});
