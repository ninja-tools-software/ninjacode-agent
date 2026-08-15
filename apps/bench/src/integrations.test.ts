import { describe, expect, it } from "vitest";
import {
  PROGRAM_BENCH_CANARY,
  toNinjaBenchTask as toProgram,
  type ProgramBenchTask,
} from "./integrations/programBench.js";
import {
  TERMINAL_BENCH_CANARY,
  toNinjaBenchTask as toTerminal,
  type TerminalBenchInstruction,
} from "./integrations/terminalBench.js";
import { computeKeepRate } from "./keepRate.js";
import { buildRunManifest, HARNESS_VERSION } from "./manifest.js";

describe("public eval adapters", () => {
  it("maps the Terminal-Bench canary into a NinjaBench task", () => {
    const instruction: TerminalBenchInstruction = TERMINAL_BENCH_CANARY;
    const task = toTerminal(instruction);
    expect(task.id).toBe("tb-echo-ok");
    expect(task.suites).toContain("terminal-bench");
    expect(task.verify).toContain("result.txt");
  });

  it("maps the ProgramBench canary into a NinjaBench task", () => {
    const canary: ProgramBenchTask = PROGRAM_BENCH_CANARY;
    const task = toProgram(canary);
    expect(task.id).toBe("pb-add-two");
    expect(task.suites).toContain("program-bench");
  });

  it("marks confirm-style manifests publishable and records harness metadata", () => {
    const manifest = buildRunManifest({
      gitSha: "abc123",
      provider: "mock",
      resolvedModel: "mock",
      publishable: true,
    });
    expect(manifest.harnessVersion).toBe(HARNESS_VERSION);
    expect(manifest.publishable).toBe(true);
    expect(manifest.contextSchema).toBe("context-v2");
    expect(manifest.mcpProtocol).toBe("none");
  });

  it("computes keep-rate from passed trials", () => {
    expect(
      computeKeepRate([
        { passed: true } as never,
        { passed: false } as never,
        { passed: true } as never,
      ]),
    ).toBeCloseTo(2 / 3);
  });
});
