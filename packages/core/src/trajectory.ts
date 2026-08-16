import { randomUUID } from "node:crypto";
import { redactTelemetryAttributes, type TelemetryAttributes } from "./telemetry.js";

export const TRAJECTORY_SCHEMA_VERSION = "1.0" as const;

export type TrajectoryEventType = "turn" | "tool" | "subagent" | "error";

export interface TrajectoryEvent {
  id: string;
  type: TrajectoryEventType;
  timestamp: number;
  durationMs?: number;
  costUsd?: number;
  success?: boolean;
  attributes?: TelemetryAttributes;
}

export interface TrajectoryOutcome {
  correctness: number;
  completed: boolean;
}

export interface Trajectory {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION;
  traceId: string;
  runId: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  events: TrajectoryEvent[];
  outcome: TrajectoryOutcome;
}

export interface TrajectoryReplay {
  schemaVersion: typeof TRAJECTORY_SCHEMA_VERSION;
  traceId: string;
  runId: string;
  correctness: number;
  completed: boolean;
  costUsd: number;
  latencyMs: number;
  turnCalls: number;
  toolCalls: number;
  subagentCalls: number;
  errors: number;
}

export interface TrajectoryComparison {
  baseline: TrajectoryReplay;
  candidate: TrajectoryReplay;
  delta: {
    correctness: number;
    costUsd: number;
    latencyMs: number;
    turnCalls: number;
    toolCalls: number;
    subagentCalls: number;
    errors: number;
  };
}

export function createTrajectory(
  input: Omit<Trajectory, "schemaVersion" | "events"> & { events?: TrajectoryEvent[] },
): Trajectory {
  assertFiniteRange(input.outcome.correctness, 0, 1, "outcome.correctness");
  if (input.endedAt < input.startedAt) throw new Error("Trajectory endedAt must not precede startedAt");
  return {
    ...input,
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    events: (input.events ?? []).map(normalizeEvent),
  };
}

export function createTrajectoryEvent(
  event: Omit<TrajectoryEvent, "id"> & { id?: string },
): TrajectoryEvent {
  return normalizeEvent({ ...event, id: event.id ?? randomUUID() });
}

export function serializeTrajectory(trajectory: Trajectory): string {
  return JSON.stringify(validateTrajectory(trajectory));
}

export function deserializeTrajectory(serialized: string): Trajectory {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Trajectory is not valid JSON");
  }
  return validateTrajectory(value);
}

export function replayTrajectory(input: string | Trajectory): TrajectoryReplay {
  const trajectory = typeof input === "string" ? deserializeTrajectory(input) : validateTrajectory(input);
  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    traceId: trajectory.traceId,
    runId: trajectory.runId,
    correctness: trajectory.outcome.correctness,
    completed: trajectory.outcome.completed,
    costUsd: sum(trajectory.events, "costUsd"),
    latencyMs: trajectory.endedAt - trajectory.startedAt,
    turnCalls: countEvents(trajectory.events, "turn"),
    toolCalls: countEvents(trajectory.events, "tool"),
    subagentCalls: countEvents(trajectory.events, "subagent"),
    errors: trajectory.events.filter((event) => event.type === "error" || event.success === false).length,
  };
}

export function compareTrajectories(
  baselineInput: string | Trajectory,
  candidateInput: string | Trajectory,
): TrajectoryComparison {
  const baseline = replayTrajectory(baselineInput);
  const candidate = replayTrajectory(candidateInput);
  return {
    baseline,
    candidate,
    delta: {
      correctness: candidate.correctness - baseline.correctness,
      costUsd: candidate.costUsd - baseline.costUsd,
      latencyMs: candidate.latencyMs - baseline.latencyMs,
      turnCalls: candidate.turnCalls - baseline.turnCalls,
      toolCalls: candidate.toolCalls - baseline.toolCalls,
      subagentCalls: candidate.subagentCalls - baseline.subagentCalls,
      errors: candidate.errors - baseline.errors,
    },
  };
}

function validateTrajectory(value: unknown): Trajectory {
  if (!isRecord(value)) throw new Error("Trajectory must be an object");
  if (value.schemaVersion !== TRAJECTORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported trajectory schema version: ${String(value.schemaVersion)}`);
  }
  requireString(value, "traceId");
  requireString(value, "runId");
  requireString(value, "sessionId");
  requireNumber(value, "startedAt");
  requireNumber(value, "endedAt");
  if (!Array.isArray(value.events)) throw new Error("Trajectory events must be an array");
  if (!isOutcome(value.outcome)) throw new Error("Trajectory outcome is invalid");
  return createTrajectory({
    traceId: value.traceId,
    runId: value.runId,
    sessionId: value.sessionId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    events: value.events.map(validateEvent),
    outcome: value.outcome,
  });
}

function validateEvent(value: unknown): TrajectoryEvent {
  if (!isRecord(value)) throw new Error("Trajectory event must be an object");
  requireString(value, "id");
  requireString(value, "type");
  requireNumber(value, "timestamp");
  if (!isEventType(value.type)) throw new Error(`Unsupported trajectory event type: ${value.type}`);
  return normalizeEvent({
    id: value.id,
    type: value.type,
    timestamp: value.timestamp,
    durationMs: optionalNumber(value.durationMs, "durationMs"),
    costUsd: optionalNumber(value.costUsd, "costUsd"),
    success: optionalBoolean(value.success, "success"),
    attributes: validateAttributes(value.attributes),
  });
}

function normalizeEvent(event: TrajectoryEvent): TrajectoryEvent {
  if (!Number.isFinite(event.timestamp)) throw new Error("Trajectory event timestamp must be finite");
  if (event.durationMs !== undefined && event.durationMs < 0) {
    throw new Error("Trajectory event durationMs must not be negative");
  }
  if (event.costUsd !== undefined && event.costUsd < 0) {
    throw new Error("Trajectory event costUsd must not be negative");
  }
  return {
    ...event,
    ...(event.attributes ? { attributes: redactTelemetryAttributes(event.attributes) } : {}),
  };
}

function validateAttributes(value: unknown): TelemetryAttributes | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Trajectory event attributes must be an object");
  for (const attribute of Object.values(value)) {
    const type = typeof attribute;
    if (attribute !== undefined && type !== "string" && type !== "number" && type !== "boolean") {
      throw new Error("Trajectory event attribute is invalid");
    }
  }
  return value as TelemetryAttributes;
}

function isOutcome(value: unknown): value is TrajectoryOutcome {
  if (!isRecord(value) || typeof value.completed !== "boolean" || typeof value.correctness !== "number") return false;
  return Number.isFinite(value.correctness) && value.correctness >= 0 && value.correctness <= 1;
}

function isEventType(value: string): value is TrajectoryEventType {
  return value === "turn" || value === "tool" || value === "subagent" || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): asserts value is Record<string, unknown> & Record<Key, string> {
  if (typeof value[key] !== "string" || value[key].length === 0) throw new Error(`Trajectory ${key} is invalid`);
}

function requireNumber<Key extends string>(
  value: Record<string, unknown>,
  key: Key,
): asserts value is Record<string, unknown> & Record<Key, number> {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) throw new Error(`Trajectory ${key} is invalid`);
}

function optionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Trajectory event ${key} is invalid`);
  return value;
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`Trajectory event ${key} is invalid`);
  return value;
}

function countEvents(events: TrajectoryEvent[], type: TrajectoryEventType): number {
  return events.filter((event) => event.type === type).length;
}

function sum(events: TrajectoryEvent[], key: "costUsd"): number {
  return events.reduce((total, event) => total + (event[key] ?? 0), 0);
}

function assertFiniteRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}
