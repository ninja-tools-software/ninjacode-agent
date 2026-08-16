import fs from "node:fs/promises";
import path from "node:path";
import type { FailureKind } from "../types.js";
import { isInfrastructureFailure } from "../verdict.js";

interface HarborTrialResult {
  task_name?: string;
  trial_name?: string;
  agent_execution?: { started_at?: string | null } | null;
  agent_result?: {
    metadata?: {
      telemetry_available?: boolean;
      telemetry_complete?: boolean;
      telemetry_error?: string;
      failure_kind?: FailureKind;
    } | null;
  } | null;
  verifier_result?: { rewards?: Record<string, number> } | null;
  exception_info?: {
    exception_type?: string;
    exception_message?: string;
  } | null;
}

interface HarborTruthTrial {
  task: string;
  trial: string;
  passed: boolean;
  failureKind?: FailureKind;
  telemetryEligible: boolean;
  telemetryAvailable: boolean;
  telemetryComplete: boolean;
}

interface HarborTruthSummary {
  trials: HarborTruthTrial[];
  tasks: string[];
  counts: Record<FailureKind | "passed", number>;
  total: number;
  evaluable: number;
  passed: number;
  correctionPassRate: number;
  infrastructureErrors: number;
  infrastructureErrorRate: number;
  telemetryEligible: number;
  telemetryCovered: number;
  telemetryCoverage: number;
}

interface HarborTruthGates {
  minimumTelemetryCoverage?: number;
  maximumInfrastructureErrorRate?: number;
  expectedTasks?: number;
  expectedAttempts?: number;
  baseline?: HarborTruthSummary;
}

interface HarborTruthGateResult {
  passed: boolean;
  failures: string[];
}

const FAILURE_KINDS: FailureKind[] = [
  "verify_failure",
  "agent_timeout",
  "verifier_timeout",
  "agent_exit",
  "infra_error",
  "cancelled",
];

export function classifyHarborFailure(
  result: HarborTrialResult,
): FailureKind | undefined {
  const exceptionType = result.exception_info?.exception_type;
  if (exceptionType === "AgentTimeoutError") return "agent_timeout";
  if (exceptionType === "VerifierTimeoutError") return "verifier_timeout";
  if (exceptionType === "NonZeroAgentExitCodeError") return "agent_exit";
  if (exceptionType === "CancelledError" || exceptionType === "Cancelled") {
    return "cancelled";
  }
  if (exceptionType) return "infra_error";

  const explicit = result.agent_result?.metadata?.failure_kind;
  if (explicit) return explicit;
  const rewards = Object.values(result.verifier_result?.rewards ?? {});
  if (rewards.length === 0 || !rewards.some((reward) => reward > 0)) {
    return "verify_failure";
  }
  return undefined;
}

export function harborTruthTrial(result: HarborTrialResult): HarborTruthTrial {
  const metadata = result.agent_result?.metadata;
  const failureKind = classifyHarborFailure(result);
  return {
    task: result.task_name ?? "unknown",
    trial: result.trial_name ?? "unknown",
    passed: failureKind === undefined,
    failureKind,
    telemetryEligible: Boolean(result.agent_execution),
    telemetryAvailable:
      metadata?.telemetry_available === true && metadata.telemetry_error === undefined,
    telemetryComplete: metadata?.telemetry_complete === true,
  };
}

export function summarizeHarborTruth(
  trials: HarborTruthTrial[],
): HarborTruthSummary {
  const counts = Object.fromEntries(
    ["passed", ...FAILURE_KINDS].map((kind) => [kind, 0]),
  ) as Record<FailureKind | "passed", number>;
  for (const trial of trials) {
    counts[trial.failureKind ?? "passed"] += 1;
  }
  const infrastructureErrors = trials.filter((trial) =>
    isInfrastructureFailure(trial.failureKind),
  ).length;
  const evaluable = trials.length - infrastructureErrors;
  const passed = counts.passed;
  const telemetryEligible = trials.filter((trial) => trial.telemetryEligible).length;
  const telemetryCovered = trials.filter(
    (trial) =>
      trial.telemetryEligible &&
      trial.telemetryAvailable &&
      trial.telemetryComplete,
  ).length;
  return {
    trials,
    tasks: [...new Set(trials.map((trial) => trial.task))].sort(),
    counts,
    total: trials.length,
    evaluable,
    passed,
    correctionPassRate: evaluable ? passed / evaluable : 0,
    infrastructureErrors,
    infrastructureErrorRate: trials.length
      ? infrastructureErrors / trials.length
      : 0,
    telemetryEligible,
    telemetryCovered,
    telemetryCoverage: telemetryEligible
      ? telemetryCovered / telemetryEligible
      : 0,
  };
}

async function trialResultPaths(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name, "result.json"));
}

export async function readHarborTruth(
  directory: string,
): Promise<HarborTruthSummary> {
  const candidates = await trialResultPaths(directory);
  const trials = (
    await Promise.all(
      candidates.map(async (file) => {
        try {
          return harborTruthTrial(
            JSON.parse(await fs.readFile(file, "utf8")) as HarborTrialResult,
          );
        } catch {
          return undefined;
        }
      }),
    )
  ).filter((trial): trial is HarborTruthTrial => trial !== undefined);
  return summarizeHarborTruth(trials);
}

function taskTrialCounts(summary: HarborTruthSummary): Map<string, number> {
  const counts = new Map<string, number>();
  for (const trial of summary.trials) {
    counts.set(trial.task, (counts.get(trial.task) ?? 0) + 1);
  }
  return counts;
}

export function evaluateHarborTruthGates(
  summary: HarborTruthSummary,
  gates: HarborTruthGates,
): HarborTruthGateResult {
  const failures: string[] = [];
  if (
    gates.minimumTelemetryCoverage !== undefined &&
    summary.telemetryCoverage < gates.minimumTelemetryCoverage
  ) {
    failures.push(
      `telemetry coverage ${(summary.telemetryCoverage * 100).toFixed(1)}% is below ` +
        `${(gates.minimumTelemetryCoverage * 100).toFixed(1)}%`,
    );
  }
  if (
    gates.maximumInfrastructureErrorRate !== undefined &&
    summary.infrastructureErrorRate > gates.maximumInfrastructureErrorRate
  ) {
    failures.push(
      `infrastructure error rate ${(summary.infrastructureErrorRate * 100).toFixed(1)}% exceeds ` +
        `${(gates.maximumInfrastructureErrorRate * 100).toFixed(1)}%`,
    );
  }
  if (
    gates.expectedTasks !== undefined &&
    summary.tasks.length !== gates.expectedTasks
  ) {
    failures.push(
      `task count ${summary.tasks.length} differs from expected ${gates.expectedTasks}`,
    );
  }
  if (gates.expectedAttempts !== undefined) {
    const mismatches = [...taskTrialCounts(summary)]
      .filter(([, count]) => count !== gates.expectedAttempts)
      .map(([task, count]) => `${task}=${count}`);
    if (mismatches.length) {
      failures.push(
        `trial counts differ from expected ${gates.expectedAttempts}: ${mismatches.join(", ")}`,
      );
    }
  }
  if (gates.baseline) {
    const baseline = [...taskTrialCounts(gates.baseline)].sort();
    const current = [...taskTrialCounts(summary)].sort();
    if (JSON.stringify(baseline) !== JSON.stringify(current)) {
      failures.push("task/trial list differs from baseline");
    }
  }
  return { passed: failures.length === 0, failures };
}

export function harborTruthMarkdown(
  summary: HarborTruthSummary,
  gate?: HarborTruthGateResult,
): string {
  const lines = [
    "# Harbor benchmark truth",
    "",
    `- Correction pass rate: ${(summary.correctionPassRate * 100).toFixed(1)}% ` +
      `(${summary.passed}/${summary.evaluable} evaluable trials)`,
    `- Infrastructure errors: ${(summary.infrastructureErrorRate * 100).toFixed(1)}% ` +
      `(${summary.infrastructureErrors}/${summary.total})`,
    `- Telemetry coverage: ${(summary.telemetryCoverage * 100).toFixed(1)}% ` +
      `(${summary.telemetryCovered}/${summary.telemetryEligible} eligible trials)`,
    "",
    "## Outcome taxonomy",
    "",
    ...(["passed", ...FAILURE_KINDS] as const).map(
      (kind) => `- ${kind}: ${summary.counts[kind]}`,
    ),
  ];
  if (gate) {
    lines.push("", "## Gates", "", gate.passed ? "PASS" : "FAIL");
    if (!gate.passed) {
      lines.push("", ...gate.failures.map((failure) => `- ${failure}`));
    }
  }
  return `${lines.join("\n")}\n`;
}
