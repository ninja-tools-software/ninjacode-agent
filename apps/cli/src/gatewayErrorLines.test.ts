import { describe, expect, it } from "vitest";
import { gatewayErrorLines, gatewayExitCode } from "./gatewayErrorLines.js";

describe("gatewayErrorLines", () => {
  it("formats insufficient_credits with renew date", () => {
    const lines = gatewayErrorLines({
      code: "insufficient_credits",
      renewsAt: "2026-09-01T00:00:00.000Z",
    });
    expect(lines[0]).toMatch(/credits/i);
    expect(lines.join("\n")).toContain("2026-09-01");
    expect(lines.join("\n")).toContain("ninjacode.dev/pricing");
  });

  it("marks terminal billing errors with exit code 3", () => {
    expect(gatewayExitCode({ code: "insufficient_credits" })).toBe(3);
    expect(gatewayExitCode({ code: "model_not_priced" })).toBe(3);
    expect(gatewayExitCode({ code: "rate_limited" })).toBe(2);
    expect(gatewayExitCode(undefined)).toBeUndefined();
  });
});
