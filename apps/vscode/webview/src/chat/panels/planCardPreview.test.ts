import { describe, expect, it } from "vitest";
import { stripLeadingH1 } from "./planCardPreview.js";

describe("stripLeadingH1", () => {
  it("removes a leading H1 and keeps the body", () => {
    expect(stripLeadingH1("# My Plan\n\nBody text")).toBe("Body text");
  });

  it("removes H1 when it is the only content", () => {
    expect(stripLeadingH1("# Title only")).toBe("");
  });

  it("leaves content unchanged when there is no leading H1", () => {
    expect(stripLeadingH1("## Section\n\nBody")).toBe("## Section\n\nBody");
  });

  it("handles leading whitespace before the H1", () => {
    expect(stripLeadingH1("  # Title\n\nBody")).toBe("Body");
  });
});
