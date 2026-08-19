import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TelemetryAttributes } from "./telemetry.js";

interface TrajectoryAgentEvent {
  type: string;
  payload: unknown;
}

export const TRAJECTORY_SCHEMA_VERSION = "1.0" as const;

export type TrajectoryEventType =
  | "turn"
  | "tool"
  | "subagent"
  | "error"
  | "phase"
  | "verification";

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
  /** False until an external verifier (for example NinjaBench) supplies correctness. */
  evaluated?: boolean;
  estimatedCostUsd?: number;
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
  timeToFirstEditMs?: number;
  longestLlmTurnMs?: number;
  readOnlyTurns: number;
  rereads: number;
  errorCategories: Record<string, number>;
  compactions: number;
  cacheReadRate?: number;
  verifications: number;
  delegations: number;
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
    timeToFirstEditMs?: number;
    longestLlmTurnMs?: number;
    readOnlyTurns: number;
    rereads: number;
    compactions: number;
    cacheReadRate?: number;
    verifications: number;
    delegations: number;
  };
}

export interface TrajectoryCaptureOptions {
  enabled?: boolean;
  runId?: string;
  traceId?: string;
  /** Explicit opt-in destination. No trajectory file is written when omitted. */
  persistPath?: string;
}

interface PendingTool {
  timestamp: number;
  name: string;
  turn?: number;
  targetHash?: string;
  verification: boolean;
}

interface PendingSubagent {
  timestamp: number;
  role?: string;
}

const TRAJECTORY_ATTRIBUTE_KEYS = new Set([
  "turn",
  "tool",
  "toolCategory",
  "targetHash",
  "errorCategory",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "mutation",
  "verification",
  "reread",
  "role",
  "category",
  "phase",
  "from",
  "reason",
  "complexity",
  "explorationBudget",
  "mutationCount",
  "recoveryCycles",
  "mode",
  "trigger",
  "localOk",
  "localAmbiguous",
  "verifierInvoked",
  "verifierCostUsd",
  "lgtm",
  "confidence",
  "cycle",
  "durationMs",
]);
const WRITE_TOOLS = new Set(["apply_patch", "edit_file", "write_file", "delete_file"]);
const READ_TOOLS = new Set(["read_file", "list_dir", "glob", "grep", "search_codebase"]);
const VERIFY_TOOLS = new Set(["read_lints", "get_errors"]);

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
  const turnEvents = trajectory.events.filter(
    (event) => event.type === "turn" && event.attributes?.category === undefined,
  );
  const usageEvents = trajectory.events.filter(
    (event) => event.type === "turn" && typeof event.attributes?.inputTokens === "number",
  );
  const toolEvents = trajectory.events.filter((event) => event.type === "tool");
  const mutationTurns = new Set(
    toolEvents
      .filter((event) => event.attributes?.mutation === true)
      .map((event) => event.attributes?.turn)
      .filter((turn): turn is number => typeof turn === "number"),
  );
  const firstEdit = toolEvents.find((event) => event.attributes?.mutation === true);
  const cacheReadTokens = sumAttribute(usageEvents, "cacheReadTokens");
  const inputTokens = sumAttribute(usageEvents, "inputTokens");
  const cacheDenominator = cacheReadTokens + inputTokens;
  return {
    schemaVersion: TRAJECTORY_SCHEMA_VERSION,
    traceId: trajectory.traceId,
    runId: trajectory.runId,
    correctness: trajectory.outcome.correctness,
    completed: trajectory.outcome.completed,
    costUsd: trajectory.outcome.estimatedCostUsd ?? sum(trajectory.events, "costUsd"),
    latencyMs: trajectory.endedAt - trajectory.startedAt,
    turnCalls: countEvents(trajectory.events, "turn"),
    toolCalls: countEvents(trajectory.events, "tool"),
    subagentCalls: countEvents(trajectory.events, "subagent"),
    errors: trajectory.events.filter((event) => event.type === "error" || event.success === false).length,
    timeToFirstEditMs: firstEdit ? Math.max(0, firstEdit.timestamp - trajectory.startedAt) : undefined,
    longestLlmTurnMs: longestDuration(trajectory.events),
    readOnlyTurns: turnEvents.filter((event) => {
      const turn = event.attributes?.turn;
      return typeof turn !== "number" || !mutationTurns.has(turn);
    }).length,
    rereads: toolEvents.filter((event) => event.attributes?.reread === true).length,
    errorCategories: countAttributeValues(trajectory.events, "errorCategory"),
    compactions: trajectory.events.filter((event) => event.attributes?.category === "compaction").length,
    cacheReadRate: cacheDenominator > 0 ? cacheReadTokens / cacheDenominator : undefined,
    verifications:
      toolEvents.filter((event) => event.attributes?.verification === true).length +
      trajectory.events.filter((event) => event.type === "verification").length,
    delegations: countEvents(trajectory.events, "subagent"),
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
      timeToFirstEditMs: optionalDelta(baseline.timeToFirstEditMs, candidate.timeToFirstEditMs),
      longestLlmTurnMs: optionalDelta(baseline.longestLlmTurnMs, candidate.longestLlmTurnMs),
      readOnlyTurns: candidate.readOnlyTurns - baseline.readOnlyTurns,
      rereads: candidate.rereads - baseline.rereads,
      compactions: candidate.compactions - baseline.compactions,
      cacheReadRate: optionalDelta(baseline.cacheReadRate, candidate.cacheReadRate),
      verifications: candidate.verifications - baseline.verifications,
      delegations: candidate.delegations - baseline.delegations,
    },
  };
}

/**
 * Captures only structural, allowlisted event metadata. Prompts, tool arguments,
 * outputs, paths and error messages never enter a trajectory.
 */
export class TrajectoryRecorder {
  readonly traceId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly startedAt: number;
  private readonly events: TrajectoryEvent[] = [];
  private readonly pendingTools = new Map<string, PendingTool>();
  private readonly pendingSubagents = new Map<string, PendingSubagent>();
  private readonly readTargets = new Set<string>();
  private currentTurn?: number;

  constructor(input: {
    sessionId: string;
    startedAt?: number;
    traceId?: string;
    runId?: string;
  }) {
    this.sessionId = input.sessionId;
    this.startedAt = input.startedAt ?? Date.now();
    this.traceId = input.traceId ?? randomUUID();
    this.runId = input.runId ?? randomUUID();
  }

  recordAgentEvent(event: TrajectoryAgentEvent, timestamp = Date.now()): void {
    const payload = asRecord(event.payload);
    switch (event.type) {
      case "usage":
        this.recordUsage(payload, timestamp);
        break;
      case "tool_start":
        this.recordToolStart(payload, timestamp);
        break;
      case "tool_end":
        this.recordToolEnd(payload, timestamp);
        break;
      case "subagent_start":
        this.recordSubagentStart(payload, timestamp);
        break;
      case "subagent_end":
        this.recordSubagentEnd(payload, timestamp);
        break;
      case "error":
      case "checkpoint_error":
        this.events.push(createTrajectoryEvent({
          type: "error",
          timestamp,
          durationMs: finiteNumber(payload.durationMs),
          success: false,
          attributes: { errorCategory: safeCategory(payload.category ?? event.type) },
        }));
        break;
      case "compaction":
        this.events.push(createTrajectoryEvent({
          type: "turn",
          timestamp,
          attributes: { category: "compaction" },
        }));
        break;
      case "phase_change":
        this.events.push(createTrajectoryEvent({
          type: "phase",
          timestamp,
          durationMs: finiteNumber(payload.durationMs),
          attributes: {
            phase: safeCategory(payload.phase),
            from: typeof payload.from === "string" ? safeCategory(payload.from) : undefined,
            reason: safeCategory(payload.reason),
            complexity: safeCategory(payload.complexity),
            explorationBudget: finiteNumber(payload.explorationBudget),
            mutationCount: finiteNumber(payload.mutationCount),
            recoveryCycles: finiteNumber(payload.recoveryCycles),
            turn: finiteNumber(payload.turn),
          },
        }));
        break;
      case "verification_end":
        this.events.push(createTrajectoryEvent({
          type: "verification",
          timestamp,
          durationMs: finiteNumber(payload.durationMs),
          costUsd: finiteNumber(payload.verifierCostUsd),
          success: typeof payload.success === "boolean" ? payload.success : undefined,
          attributes: {
            mode: safeCategory(payload.mode),
            trigger:
              typeof payload.trigger === "string" ? safeCategory(payload.trigger) : undefined,
            localOk: typeof payload.localOk === "boolean" ? payload.localOk : undefined,
            localAmbiguous:
              typeof payload.localAmbiguous === "boolean" ? payload.localAmbiguous : undefined,
            verifierInvoked:
              typeof payload.verifierInvoked === "boolean" ? payload.verifierInvoked : undefined,
            verifierCostUsd: finiteNumber(payload.verifierCostUsd),
            lgtm: typeof payload.lgtm === "boolean" ? payload.lgtm : undefined,
            confidence: finiteNumber(payload.confidence),
            cycle: finiteNumber(payload.cycle),
          },
        }));
        break;
      default:
        break;
    }
  }

  finalize(input: {
    completed: boolean;
    correctness?: number;
    evaluated?: boolean;
    estimatedCostUsd?: number;
    endedAt?: number;
  }): Trajectory {
    return createTrajectory({
      traceId: this.traceId,
      runId: this.runId,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: Math.max(this.startedAt, input.endedAt ?? Date.now()),
      events: this.events,
      outcome: {
        correctness: input.correctness ?? 0,
        completed: input.completed,
        evaluated: input.evaluated ?? input.correctness !== undefined,
        estimatedCostUsd: input.estimatedCostUsd,
      },
    });
  }

  private recordUsage(payload: Record<string, unknown>, timestamp: number): void {
    const usage = asRecord(payload.usage);
    const compaction = payload.category === "compaction";
    const turn = compaction
      ? undefined
      : finiteNumber(payload.turn) ?? (this.currentTurn === undefined ? 1 : this.currentTurn + 1);
    if (turn !== undefined) this.currentTurn = turn;
    this.events.push(createTrajectoryEvent({
      type: "turn",
      timestamp,
      durationMs: finiteNumber(payload.durationMs),
      attributes: {
        turn,
        category: compaction ? "compaction_usage" : undefined,
        inputTokens: finiteNumber(usage.inputTokens) ?? 0,
        outputTokens: finiteNumber(usage.outputTokens) ?? 0,
        cacheReadTokens: finiteNumber(usage.cacheReadTokens) ?? 0,
        cacheWriteTokens: finiteNumber(usage.cacheWriteTokens) ?? 0,
      },
    }));
  }

  private recordToolStart(payload: Record<string, unknown>, timestamp: number): void {
    if (typeof payload.id !== "string" || typeof payload.name !== "string") return;
    const targetHash =
      READ_TOOLS.has(payload.name) && typeof payload.target === "string"
        ? hashPrivateTarget(payload.target)
        : undefined;
    this.pendingTools.set(payload.id, {
      timestamp,
      name: safeToolName(payload.name),
      turn: this.currentTurn,
      targetHash,
      verification: isVerification(payload.name, asRecord(payload.arguments)),
    });
  }

  private recordToolEnd(payload: Record<string, unknown>, timestamp: number): void {
    if (typeof payload.id !== "string") return;
    const pending = this.pendingTools.get(payload.id);
    if (!pending) return;
    this.pendingTools.delete(payload.id);
    const name = safeToolName(pending.name);
    const mutation = WRITE_TOOLS.has(name);
    const targetHash = pending?.targetHash;
    const reread = targetHash !== undefined && this.readTargets.has(targetHash);
    if (targetHash) this.readTargets.add(targetHash);
    this.events.push(createTrajectoryEvent({
      type: "tool",
      timestamp: pending.timestamp,
      durationMs: Math.max(0, timestamp - pending.timestamp),
      success: typeof payload.error !== "string",
      attributes: {
        turn: pending.turn,
        tool: name,
        toolCategory: mutation ? "write" : pending?.verification ? "verify" : READ_TOOLS.has(name) ? "read" : "other",
        targetHash,
        mutation,
        verification: pending?.verification ?? false,
        reread,
        errorCategory: payload.error ? safeCategory(payload.category ?? "tool_error") : undefined,
      },
    }));
  }

  private recordSubagentStart(payload: Record<string, unknown>, timestamp: number): void {
    const id = typeof payload.id === "string" ? payload.id : randomUUID();
    this.pendingSubagents.set(id, {
      timestamp,
      role: typeof payload.role === "string" ? safeCategory(payload.role) : undefined,
    });
  }

  private recordSubagentEnd(payload: Record<string, unknown>, timestamp: number): void {
    const id = typeof payload.id === "string" ? payload.id : "";
    const pending = this.pendingSubagents.get(id);
    if (!pending) return;
    this.pendingSubagents.delete(id);
    this.events.push(createTrajectoryEvent({
      type: "subagent",
      timestamp: pending?.timestamp ?? timestamp,
      durationMs: pending ? Math.max(0, timestamp - pending.timestamp) : finiteNumber(payload.durationMs),
      success: payload.error === undefined && payload.aborted !== true,
      attributes: {
        role: pending?.role,
        errorCategory: payload.error !== undefined ? "subagent_error" : undefined,
      },
    }));
  }
}

export function attachTrajectoryOutcome(
  trajectory: Trajectory,
  outcome: Partial<TrajectoryOutcome> & Pick<TrajectoryOutcome, "correctness">,
): Trajectory {
  return createTrajectory({
    ...trajectory,
    outcome: { ...trajectory.outcome, ...outcome, evaluated: true },
  });
}

export async function persistTrajectory(file: string, trajectory: Trajectory): Promise<void> {
  const resolved = path.resolve(file);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${serializeTrajectory(trajectory)}\n`, { mode: 0o600 });
  await fs.rename(temporary, resolved);
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
    ...(event.attributes ? { attributes: sanitizeTrajectoryAttributes(event.attributes) } : {}),
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

function sanitizeTrajectoryAttributes(attributes: TelemetryAttributes): TelemetryAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      TRAJECTORY_ATTRIBUTE_KEYS.has(key) ? value : "[REDACTED]",
    ]),
  );
}

function isOutcome(value: unknown): value is TrajectoryOutcome {
  if (!isRecord(value) || typeof value.completed !== "boolean" || typeof value.correctness !== "number") return false;
  return Number.isFinite(value.correctness) && value.correctness >= 0 && value.correctness <= 1;
}

function isEventType(value: string): value is TrajectoryEventType {
  return value === "turn" ||
    value === "tool" ||
    value === "subagent" ||
    value === "error" ||
    value === "phase" ||
    value === "verification";
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

function sumAttribute(events: TrajectoryEvent[], key: string): number {
  return events.reduce((total, event) => total + (finiteNumber(event.attributes?.[key]) ?? 0), 0);
}

function countAttributeValues(events: TrajectoryEvent[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const value = event.attributes?.[key];
    if (typeof value === "string") counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function optionalDelta(baseline: number | undefined, candidate: number | undefined): number | undefined {
  return baseline === undefined || candidate === undefined ? undefined : candidate - baseline;
}

function longestDuration(events: TrajectoryEvent[]): number | undefined {
  let longest: number | undefined;
  for (const event of events) {
    if (event.durationMs === undefined) continue;
    if (event.type !== "turn" || event.attributes?.category !== undefined) continue;
    longest = longest === undefined ? event.durationMs : Math.max(longest, event.durationMs);
  }
  return longest;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeToolName(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : "unknown";
}

function safeCategory(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : "unknown";
}

function hashPrivateTarget(target: string): string {
  return createHash("sha256").update(target).digest("hex").slice(0, 16);
}

function isVerification(tool: string, args: Record<string, unknown>): boolean {
  if (VERIFY_TOOLS.has(tool)) return true;
  if (tool !== "run_shell") return false;
  const command = typeof args.command === "string" ? args.command : "";
  return /\b(test|typecheck|lint|vitest|jest|pytest|cargo test|go test|build)\b/i.test(command);
}

function assertFiniteRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}
