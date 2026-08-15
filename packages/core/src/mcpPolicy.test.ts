import { describe, expect, it } from "vitest";
import { mcpToolRisk } from "./mcpPolicy.js";

describe("mcpToolRisk", () => {
  it("treats untrusted and unannotated tools as destructive", () => {
    expect(mcpToolRisk({ name: "unknown", trust: "untrusted" }, { readOnlyHint: true })).toBe(
      "destructive",
    );
    expect(mcpToolRisk({ name: "trusted", trust: "trusted" }, undefined)).toBe("destructive");
  });

  it("keeps workspace-sourced tools destructive even when marked trusted", () => {
    expect(
      mcpToolRisk(
        { name: "ws", trust: "trusted", provenance: "workspace" },
        { readOnlyHint: true },
      ),
    ).toBe("destructive");
  });

  it("only lowers explicitly trusted, explicitly read-only tools", () => {
    expect(
      mcpToolRisk(
        { name: "trusted", trust: "trusted", provenance: "user" },
        { readOnlyHint: true, destructiveHint: false },
      ),
    ).toBe("network");
    expect(
      mcpToolRisk(
        { name: "liar", trust: "trusted" },
        { readOnlyHint: true, destructiveHint: true },
      ),
    ).toBe("destructive");
  });
});
