import type { FailureKind } from "../../types.js";

interface CanaryTrialFixture {
  task_name: string;
  trial_name: string;
  agent_execution: { started_at: string };
  agent_result: {
    metadata: {
      telemetry_available: true;
      telemetry_complete: true;
      failure_kind: FailureKind;
      completed: false;
      stop_reason: "timeout";
      trajectory: {
        turns: number;
        timeToFirstEditMs: number | null;
        longestLlmTurnMs: number;
      };
    };
  };
  verifier_result: { rewards: { reward: 0 } };
}

/** Derived from runs/harbor/canary-20260816-211530 — 3/3 agent_timeout, reward 0. */
export const CANARY_20260816_211530_TRIALS: CanaryTrialFixture[] = [
  {
    task_name: "terminal-bench/write-compressor",
    trial_name: "write-compressor__9pxbpaL",
    agent_execution: { started_at: "2026-08-16T19:17:08.201873Z" },
    agent_result: {
      metadata: {
        telemetry_available: true,
        telemetry_complete: true,
        failure_kind: "agent_timeout",
        completed: false,
        stop_reason: "timeout",
        trajectory: {
          turns: 7,
          timeToFirstEditMs: 836_797,
          longestLlmTurnMs: 314_827,
        },
      },
    },
    verifier_result: { rewards: { reward: 0 } },
  },
  {
    task_name: "terminal-bench/write-compressor",
    trial_name: "write-compressor__jCdzFcy",
    agent_execution: { started_at: "2026-08-16T19:17:05.272289Z" },
    agent_result: {
      metadata: {
        telemetry_available: true,
        telemetry_complete: true,
        failure_kind: "agent_timeout",
        completed: false,
        stop_reason: "timeout",
        trajectory: {
          turns: 4,
          timeToFirstEditMs: null,
          longestLlmTurnMs: 314_031,
        },
      },
    },
    verifier_result: { rewards: { reward: 0 } },
  },
  {
    task_name: "terminal-bench/write-compressor",
    trial_name: "write-compressor__rcReQgT",
    agent_execution: { started_at: "2026-08-16T19:16:56.084416Z" },
    agent_result: {
      metadata: {
        telemetry_available: true,
        telemetry_complete: true,
        failure_kind: "agent_timeout",
        completed: false,
        stop_reason: "timeout",
        trajectory: {
          turns: 4,
          timeToFirstEditMs: null,
          longestLlmTurnMs: 335_657,
        },
      },
    },
    verifier_result: { rewards: { reward: 0 } },
  },
];
