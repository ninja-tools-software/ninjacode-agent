import { describe, expect, it } from "vitest";
import { parseArgs } from "./cliArgs.js";
import { isWorkspaceTrusted } from "./runTask.js";

describe("CLI workspace trust", () => {
  it("requires the dedicated boolean flag", () => {
    expect(isWorkspaceTrusted({})).toBe(false);
    expect(isWorkspaceTrusted({ yes: true })).toBe(false);
    expect(isWorkspaceTrusted({ "trust-workspace": "true" })).toBe(false);
    expect(isWorkspaceTrusted({ "trust-workspace": true })).toBe(true);
  });

  it("parses --trust-workspace without consuming the task", () => {
    const parsed = parseArgs(["run", "--trust-workspace", "edit", "src/index.ts"]);

    expect(parsed.flags["trust-workspace"]).toBe(true);
    expect(parsed.positional).toEqual(["edit", "src/index.ts"]);
  });
});
