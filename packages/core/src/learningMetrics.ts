import { randomUUID } from "node:crypto";
import type { TelemetryContext } from "./telemetry.js";

export type LearningDecision = "keep" | "rollback";

export interface LearningFeedback {
  id: string;
  timestamp: number;
  decision: LearningDecision;
  satisfaction?: number;
  traceId?: string;
  runId?: string;
  sessionId?: string;
  turnId?: string;
}

export interface LearningFeedbackInput {
  decision: LearningDecision;
  satisfaction?: number;
  context?: TelemetryContext;
  timestamp?: number;
}

export interface LearningMetricsSink {
  record(feedback: LearningFeedback): void | Promise<void>;
  flush?(): Promise<void>;
}

let isEnabled = false;
let sink: LearningMetricsSink | undefined;

/**
 * Learning feedback is disabled by default and has no implicit persistence.
 * Enabling it requires an explicit sink controlled by the host.
 */
export function configureLearningMetrics(
  options: { enabled: boolean; sink?: LearningMetricsSink },
): void {
  isEnabled = options.enabled;
  sink = options.sink;
}

export function recordLearningFeedback(input: LearningFeedbackInput): boolean {
  if (!isEnabled || !sink) return false;
  validateSatisfaction(input.satisfaction);
  const feedback: LearningFeedback = {
    id: randomUUID(),
    timestamp: input.timestamp ?? Date.now(),
    decision: input.decision,
    satisfaction: input.satisfaction,
    traceId: input.context?.traceId,
    runId: input.context?.runId,
    sessionId: input.context?.sessionId,
    turnId: input.context?.turnId,
  };
  try {
    const result = sink.record(feedback);
    if (result) void result.catch(() => undefined);
  } catch {
    return false;
  }
  return true;
}

export async function flushLearningMetrics(): Promise<void> {
  if (!isEnabled || !sink) return;
  await sink.flush?.();
}

function validateSatisfaction(value: number | undefined): void {
  if (value === undefined) return;
  if (Number.isInteger(value) && value >= 1 && value <= 5) return;
  throw new Error("Learning satisfaction must be an integer between 1 and 5");
}
