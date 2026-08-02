import type { BenchTask, TaskResult } from "./types.js";

/**
 * Pure pass/fail decision after an agent run.
 * Separated so harness scenarios can expect agent_error / minToolErrors.
 */
export function decideTaskVerdict(opts: {
  task: BenchTask;
  timedOut?: boolean;
  agentError?: string;
  toolErrors?: number;
  verifyOk: boolean;
}): { passed: boolean; failureKind?: TaskResult["failureKind"] } {
  const { task, timedOut, agentError, toolErrors = 0, verifyOk } = opts;
  const kind: TaskResult["failureKind"] | undefined = timedOut
    ? "timeout"
    : agentError
      ? "agent_error"
      : verifyOk
        ? undefined
        : "verify";

  if (task.expectFailureKind) {
    const passed = kind === task.expectFailureKind;
    return { passed, failureKind: passed ? undefined : kind ?? "verify" };
  }

  if (timedOut) return { passed: false, failureKind: "timeout" };
  if (agentError) return { passed: false, failureKind: "agent_error" };
  if (!verifyOk) return { passed: false, failureKind: "verify" };
  if (task.minToolErrors !== undefined && toolErrors < task.minToolErrors) {
    return { passed: false, failureKind: "verify" };
  }
  return { passed: true };
}
