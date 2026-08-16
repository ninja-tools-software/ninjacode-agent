import type { BenchTask, FailureKind, TaskResult } from "./types.js";

const INFRASTRUCTURE_FAILURES = new Set<FailureKind>([
  "verifier_timeout",
  "infra_error",
  "cancelled",
]);

export function isInfrastructureFailure(kind: FailureKind | undefined): boolean {
  return kind !== undefined && INFRASTRUCTURE_FAILURES.has(kind);
}

function normalizeExpectedFailure(
  kind: BenchTask["expectFailureKind"],
): FailureKind | undefined {
  if (kind === "agent_error") return "agent_exit";
  if (kind === "timeout") return "agent_timeout";
  return kind;
}

function classifyFailure(opts: {
  timedOut?: boolean;
  verifierTimedOut?: boolean;
  cancelled?: boolean;
  infraError?: string;
  agentError?: string;
  verifyOk: boolean;
}): FailureKind | undefined {
  if (opts.timedOut) return "agent_timeout";
  if (opts.verifierTimedOut) return "verifier_timeout";
  if (opts.cancelled) return "cancelled";
  if (opts.infraError) return "infra_error";
  if (opts.agentError) return "agent_exit";
  return opts.verifyOk ? undefined : "verify_failure";
}

/**
 * Pure pass/fail decision after an agent run.
 * Separated so harness scenarios can expect agent_error / minToolErrors.
 */
export function decideTaskVerdict(opts: {
  task: BenchTask;
  timedOut?: boolean;
  verifierTimedOut?: boolean;
  cancelled?: boolean;
  infraError?: string;
  agentError?: string;
  toolErrors?: number;
  verifyOk: boolean;
}): { passed: boolean; failureKind?: TaskResult["failureKind"] } {
  const {
    task,
    timedOut,
    verifierTimedOut,
    cancelled,
    infraError,
    agentError,
    toolErrors = 0,
    verifyOk,
  } = opts;
  const kind = classifyFailure({
    timedOut,
    verifierTimedOut,
    cancelled,
    infraError,
    agentError,
    verifyOk,
  });

  if (task.expectFailureKind) {
    const passed = kind === normalizeExpectedFailure(task.expectFailureKind);
    return { passed, failureKind: passed ? undefined : kind ?? "verify_failure" };
  }

  if (kind) return { passed: false, failureKind: kind };
  if (task.minToolErrors !== undefined && toolErrors < task.minToolErrors) {
    return { passed: false, failureKind: "verify_failure" };
  }
  return { passed: true };
}
