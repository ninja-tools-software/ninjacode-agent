import { describe, expect, it } from "vitest";
import { condenseVerifyOutput } from "./verifyOutput.js";

/** Shape of a real `tsc --noEmit` run: the diagnostics sit among progress noise. */
const TSC_OUTPUT = [
  "> @ninjacode/core@0.1.0 typecheck",
  "> tsc -p tsconfig.json --noEmit",
  "",
  "src/agent.ts(42,11): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
  "src/context.ts(118,3): error TS2554: Expected 2 arguments, but got 1.",
  "",
  "Found 2 errors in 2 files.",
].join("\n");

/** Shape of a real `vitest run`: the failure summary is at the very end. */
const VITEST_OUTPUT = [
  " RUN  v3.2.7 /repo",
  "",
  ...Array.from({ length: 120 }, (_, i) => ` ✓ src/noise${i}.test.ts (3 tests) 2ms`),
  " ❯ src/context.test.ts (4 tests | 1 failed)",
  "   × compactHistory > keeps the pinned task",
  "",
  "AssertionError: expected 3 to be 4",
  " ❯ src/context.test.ts:88:24",
  "",
  " Test Files  1 failed | 12 passed (13)",
  "      Tests  1 failed | 40 passed (41)",
].join("\n");

describe("condenseVerifyOutput", () => {
  it("keeps tsc diagnostics and drops the script banner", () => {
    const condensed = condenseVerifyOutput(TSC_OUTPUT, "");
    expect(condensed).toContain("src/agent.ts(42,11): error TS2345");
    expect(condensed).toContain("src/context.ts(118,3): error TS2554");
    expect(condensed).toContain("Found 2 errors");
    expect(condensed).not.toContain("> tsc -p tsconfig.json");
  });

  it("surfaces the vitest failure that a head-only slice would have cut off", () => {
    const condensed = condenseVerifyOutput(VITEST_OUTPUT, "");
    expect(condensed).toContain("AssertionError: expected 3 to be 4");
    expect(condensed).toContain("src/context.test.ts:88:24");
    expect(condensed).not.toContain("✓ src/noise0.test.ts");
    // The head-only truncation this replaces would have kept the passing noise.
    expect(VITEST_OUTPUT.slice(0, 4000)).not.toContain("AssertionError");
  });

  it("caps the number of diagnostic lines and says how many were dropped", () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `src/f${i}.ts(1,1): error TS2345: Type mismatch.`,
    ).join("\n");
    const condensed = condenseVerifyOutput(many, "");
    expect(condensed.split("\n").filter((l) => l.includes("error TS"))).toHaveLength(20);
    expect(condensed).toContain("10 more diagnostic line(s)");
  });

  it("keeps both ends when nothing looks like a diagnostic", () => {
    const filler = "x".repeat(6000);
    const output = `START-MARKER\n${filler}\nEND-MARKER`;
    const condensed = condenseVerifyOutput(output, "");
    expect(condensed).toContain("START-MARKER");
    expect(condensed).toContain("END-MARKER");
    expect(condensed).toContain("characters omitted");
    expect(condensed.length).toBeLessThan(output.length);
  });

  it("returns short unrecognised output verbatim", () => {
    expect(condenseVerifyOutput("make: nothing to be done", "")).toBe("make: nothing to be done");
  });

  it("merges stderr into the search and handles empty output", () => {
    expect(condenseVerifyOutput("", "src/a.ts(3,1): error TS1005: ';' expected.")).toContain(
      "error TS1005",
    );
    expect(condenseVerifyOutput("", "")).toBe("");
    expect(condenseVerifyOutput("   ", "\n")).toBe("");
  });

  it("truncates a single pathological diagnostic line", () => {
    const long = `src/a.ts(1,1): error TS2322: ${"y".repeat(2000)}`;
    const condensed = condenseVerifyOutput(long, "");
    expect(condensed.length).toBeLessThan(500);
    expect(condensed).toContain("error TS2322");
  });
});
