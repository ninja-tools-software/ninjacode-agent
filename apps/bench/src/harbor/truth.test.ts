import { describe, expect, it } from "vitest";
import {
  classifyHarborFailure,
  evaluateHarborTruthGates,
  harborTruthMarkdown,
  harborTruthTrial,
  summarizeHarborTruth,
} from "./truth.js";
import { CANARY_20260816_211530_TRIALS } from "./fixtures/canary-20260816-211530.js";

describe("Harbor benchmark truth", () => {
  it("maps Harbor failures without treating infrastructure as correction", () => {
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "AgentTimeoutError" },
      }),
    ).toBe("agent_timeout");
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "VerifierTimeoutError" },
      }),
    ).toBe("verifier_timeout");
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "NonZeroAgentExitCodeError" },
      }),
    ).toBe("agent_exit");
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "RuntimeError" },
      }),
    ).toBe("infra_error");
    expect(
      classifyHarborFailure({
        verifier_result: { rewards: { reward: 0 } },
      }),
    ).toBe("verify_failure");
  });

  it("prefers complete telemetry over a leftover NonZeroAgentExitCodeError", () => {
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "NonZeroAgentExitCodeError" },
        agent_result: {
          metadata: {
            telemetry_available: true,
            telemetry_complete: true,
            failure_kind: "agent_timeout",
          },
        },
        verifier_result: { rewards: { reward: 0 } },
      }),
    ).toBe("agent_timeout");
    expect(
      classifyHarborFailure({
        exception_info: { exception_type: "NonZeroAgentExitCodeError" },
        agent_result: {
          metadata: {
            telemetry_available: false,
            telemetry_complete: false,
          },
        },
      }),
    ).toBe("agent_exit");
    expect(
      classifyHarborFailure({
        agent_result: {
          metadata: {
            telemetry_available: true,
            telemetry_complete: true,
          },
        },
        verifier_result: { rewards: { reward: 0 } },
      }),
    ).toBe("verify_failure");
  });

  it("reports explicit telemetry coverage and correction denominator", () => {
    const passed = harborTruthTrial({
      task_name: "a",
      trial_name: "a__1",
      agent_execution: { started_at: "now" },
      agent_result: {
        metadata: {
          telemetry_available: true,
          telemetry_complete: true,
        },
      },
      verifier_result: { rewards: { reward: 1 } },
    });
    const infra = harborTruthTrial({
      task_name: "b",
      trial_name: "b__1",
      exception_info: { exception_type: "RuntimeError" },
    });
    const summary = summarizeHarborTruth([passed, infra]);
    expect(summary.correctionPassRate).toBe(1);
    expect(summary.infrastructureErrorRate).toBe(0.5);
    expect(summary.telemetryCoverage).toBe(1);
  });

  it("keeps agent_timeout as an operational failure while reporting verifier success", () => {
    const trial = harborTruthTrial({
      task_name: "path-tracing",
      trial_name: "path-tracing__1",
      agent_execution: { started_at: "now" },
      exception_info: { exception_type: "AgentTimeoutError" },
      agent_result: {
        metadata: {
          telemetry_available: true,
          telemetry_complete: true,
          failure_kind: "agent_timeout",
          completed: false,
          stop_reason: "timeout",
        },
      },
      verifier_result: { rewards: { reward: 1 } },
    });
    expect(trial.passed).toBe(false);
    expect(trial.failureKind).toBe("agent_timeout");
    expect(trial.verifierPassed).toBe(true);
    expect(trial.agentCompleted).toBe(false);
    const summary = summarizeHarborTruth([trial]);
    expect(summary.correctButTimedOut).toBe(1);
    expect(summary.correctionPassRate).toBe(0);
  });

  it("gates telemetry, infra, tasks, trials, and baseline compatibility", () => {
    const summary = summarizeHarborTruth([
      {
        task: "a",
        trial: "a__1",
        passed: false,
        failureKind: "infra_error",
        verifierPassed: false,
        agentCompleted: false,
        telemetryEligible: true,
        telemetryAvailable: false,
        telemetryComplete: false,
      },
    ]);
    const gate = evaluateHarborTruthGates(summary, {
      minimumTelemetryCoverage: 0.95,
      maximumInfrastructureErrorRate: 0.05,
      expectedTasks: 2,
      expectedAttempts: 3,
      baseline: summarizeHarborTruth([]),
    });
    expect(gate.passed).toBe(false);
    expect(gate.failures).toHaveLength(5);
  });

  it("fails canary operational gates on the 20260816 timeout run", () => {
    const summary = summarizeHarborTruth(
      CANARY_20260816_211530_TRIALS.map((trial) => harborTruthTrial(trial)),
    );
    const gate = evaluateHarborTruthGates(summary, {
      expectedTasks: 1,
      expectedAttempts: 3,
      minimumCorrectionPassRate: 0.666,
      maximumAgentTimeoutRate: 0,
    });
    expect(summary.correctionPassRate).toBe(0);
    expect(summary.agentTimeoutRate).toBe(1);
    expect(summary.longestLlmTurnMs).toBe(335_657);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("\n")).toMatch(/correction pass rate/);
    expect(gate.failures.join("\n")).toMatch(/agent timeout rate/);
    expect(harborTruthMarkdown(summary, gate)).toMatch(/Agent timeout rate/);
  });
});
