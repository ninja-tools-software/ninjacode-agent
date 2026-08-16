import { describe, expect, it } from "vitest";
import { parseArgs } from "./cliArgs.js";
import { incompleteRunExitCode, isWorkspaceTrusted } from "./runTask.js";

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

describe("Harbor incomplete-run exit code", () => {
  it("exits 0 once final telemetry is written", () => {
    expect(
      incompleteRunExitCode({ harborTelemetry: true, wroteFinalTelemetry: true, gatewayExit: 2 }),
    ).toBe(0);
  });

  it("keeps a non-zero exit when telemetry is missing or the run is not Harbor", () => {
    expect(incompleteRunExitCode({ harborTelemetry: true, wroteFinalTelemetry: false })).toBe(2);
    expect(incompleteRunExitCode({ harborTelemetry: false, wroteFinalTelemetry: false })).toBe(2);
    expect(
      incompleteRunExitCode({ harborTelemetry: false, wroteFinalTelemetry: true, gatewayExit: 3 }),
    ).toBe(3);
  });
});
