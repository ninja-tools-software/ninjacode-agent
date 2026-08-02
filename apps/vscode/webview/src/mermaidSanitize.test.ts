import { describe, expect, it } from "vitest";
import { sanitizeMermaidSource } from "./mermaidSanitize.js";

describe("sanitizeMermaidSource", () => {
  it("quotes labels containing @", () => {
    expect(sanitizeMermaidSource("Core[@ninjacode/core - Agent Loop]")).toBe(
      'Core["@ninjacode/core - Agent Loop"]',
    );
  });

  it("quotes labels containing /", () => {
    expect(sanitizeMermaidSource("JB[JetBrains / Zed]")).toBe('JB["JetBrains / Zed"]');
  });

  it("leaves simple labels unchanged", () => {
    expect(sanitizeMermaidSource("VSCode[VS Code Extension]")).toBe("VSCode[VS Code Extension]");
    expect(sanitizeMermaidSource('Core["already quoted"]')).toBe('Core["already quoted"]');
  });
});
