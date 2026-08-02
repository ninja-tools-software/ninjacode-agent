import { describe, expect, it } from "vitest";
import { decideTaskVerdict } from "./verdict.js";
import type { BenchTask } from "./types.js";

const base: BenchTask = {
  id: "t",
  description: "",
  category: "fix",
  difficulty: "easy",
  prompt: "",
  verify: "true",
};

describe("decideTaskVerdict", () => {
  it("passes on verify success", () => {
    expect(decideTaskVerdict({ task: base, verifyOk: true })).toEqual({ passed: true });
  });

  it("fails on verify / agent_error / timeout", () => {
    expect(decideTaskVerdict({ task: base, verifyOk: false }).failureKind).toBe("verify");
    expect(
      decideTaskVerdict({ task: base, verifyOk: true, agentError: "boom" }).failureKind,
    ).toBe("agent_error");
    expect(decideTaskVerdict({ task: base, verifyOk: true, timedOut: true }).failureKind).toBe(
      "timeout",
    );
  });

  it("passes when expectFailureKind matches", () => {
    const task = { ...base, expectFailureKind: "agent_error" as const };
    expect(
      decideTaskVerdict({ task, verifyOk: false, agentError: "Max turns reached" }),
    ).toEqual({ passed: true, failureKind: undefined });
    expect(decideTaskVerdict({ task, verifyOk: true })).toEqual({
      passed: false,
      failureKind: "verify",
    });
  });

  it("requires minToolErrors after successful verify", () => {
    const task = { ...base, minToolErrors: 1 };
    expect(decideTaskVerdict({ task, verifyOk: true, toolErrors: 0 }).failureKind).toBe("verify");
    expect(decideTaskVerdict({ task, verifyOk: true, toolErrors: 1 })).toEqual({ passed: true });
  });
});
