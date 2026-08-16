import { describe, expect, it } from "vitest";
import { uniqueSmokeJobName, withJobName } from "./cli.js";

describe("Harbor smoke job names", () => {
  it("generates a unique smoke-<timestamp> name", () => {
    expect(uniqueSmokeJobName(new Date(2026, 7, 16, 10, 33, 29))).toBe("smoke-20260816-103329");
  });

  it("does not override an explicit --job-name", () => {
    expect(withJobName(["--job-name", "smoke-manual", "-o", "runs/harbor"], "smoke-auto")).toEqual([
      "--job-name",
      "smoke-manual",
      "-o",
      "runs/harbor",
    ]);
    expect(withJobName(["-o", "runs/harbor"], "smoke-auto")).toEqual([
      "--job-name",
      "smoke-auto",
      "-o",
      "runs/harbor",
    ]);
  });
});
