import { describe, expect, it } from "vitest";
import { resolveEnrichResultText } from "./enhancePrompt.js";

describe("resolveEnrichResultText", () => {
  it("returns trimmed gateway text", () => {
    expect(resolveEnrichResultText({ text: "  Add tests for auth\n" }, "x")).toBe(
      "Add tests for auth",
    );
  });

  it("falls back when text is missing or empty", () => {
    expect(resolveEnrichResultText({}, "  original  ")).toBe("original");
    expect(resolveEnrichResultText({ text: "   " }, "original")).toBe("original");
    expect(resolveEnrichResultText(null, "original")).toBe("original");
  });
});
