import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import { preferredEditFormat, filterToolsForEditFormat } from "./editTools.js";

describe("editTools", () => {
  it("prefers string_replace for anthropic", () => {
    expect(preferredEditFormat("anthropic", "claude-sonnet-4-20250514")).toBe("string_replace");
  });

  it("prefers patch for openai", () => {
    expect(preferredEditFormat("openai", "gpt-4o")).toBe("patch");
  });

  it("prefers string_replace for Grok 4.6", () => {
    expect(preferredEditFormat("xai", "grok-4.6")).toBe("string_replace");
  });

  it("exposes a single edit format at a time", () => {
    const reg = createDefaultToolRegistry();
    const patchOnly = filterToolsForEditFormat(reg, "patch");
    expect(patchOnly.get("apply_patch")).toBeDefined();
    expect(patchOnly.get("edit_file")).toBeUndefined();
  });
});
