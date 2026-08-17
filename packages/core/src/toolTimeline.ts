import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { redact, truncateForLog } from "./agentLogs.js";

export const TOOL_TIMELINE_SCHEMA_VERSION = "1.0" as const;
const ARG_PREVIEW_CHARS = 160;

export interface ToolTimelineTurn {
  turn: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCount: number;
  batchSize: number;
}

export interface ToolTimelineEntry {
  turn?: number;
  tool: string;
  success: boolean;
  durationMs: number;
      errorCategory?: string;
      argPreview?: string;
      batchSize: number;
      outputChars?: number;
      visibleChars?: number;
      truncated?: boolean;
    }

export interface ToolTimeline {
  schemaVersion: typeof TOOL_TIMELINE_SCHEMA_VERSION;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  turns: ToolTimelineTurn[];
  tools: ToolTimelineEntry[];
}

interface PendingTool {
  timestamp: number;
  name: string;
  turn?: number;
  argPreview?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function summarizeToolArgs(name: string, args: Record<string, unknown>): string | undefined {
  if (typeof args.path === "string" && args.path.trim()) {
    return redact(truncateForLog(args.path.trim(), ARG_PREVIEW_CHARS));
  }
  if (name === "run_shell" && typeof args.command === "string") {
    return redact(truncateForLog(args.command.trim(), ARG_PREVIEW_CHARS));
  }
  if (typeof args.patch === "string") return `patch:${args.patch.length} chars`;
  if (typeof args.content === "string") return `content:${args.content.length} chars`;
  const keys = Object.keys(args).filter((key) => key !== "_truncated").slice(0, 6);
  if (keys.length === 0) return undefined;
  return redact(truncateForLog(keys.join(","), ARG_PREVIEW_CHARS));
}

export function siblingArtifactPath(trajectoryPath: string, fileName: string): string {
  return path.join(path.dirname(path.resolve(trajectoryPath)), fileName);
}

/**
 * Compact, redacted per-tool timeline for Harbor diagnosis. Paths and truncated
 * shell commands are allowed; file bodies, prompts and secrets are not.
 */
export class ToolTimelineRecorder {
  readonly sessionId: string;
  readonly startedAt: number;
  private currentTurn?: number;
  private readonly pending = new Map<string, PendingTool>();
  private readonly tools: ToolTimelineEntry[] = [];
  private readonly turnUsage = new Map<number, ToolTimelineTurn>();

  constructor(input: { sessionId: string; startedAt?: number }) {
    this.sessionId = input.sessionId;
    this.startedAt = input.startedAt ?? Date.now();
  }

  recordAgentEvent(event: { type: string; payload: unknown }, timestamp = Date.now()): void {
    const payload = asRecord(event.payload);
    if (event.type === "usage") {
      const usage = asRecord(payload.usage);
      if (payload.category === "compaction") return;
      const turn = finiteNumber(payload.turn) ?? (this.currentTurn === undefined ? 1 : this.currentTurn + 1);
      this.currentTurn = turn;
      this.turnUsage.set(turn, {
        turn,
        inputTokens: finiteNumber(usage.inputTokens) ?? 0,
        outputTokens: finiteNumber(usage.outputTokens) ?? 0,
        cacheReadTokens: finiteNumber(usage.cacheReadTokens) ?? 0,
        cacheWriteTokens: finiteNumber(usage.cacheWriteTokens) ?? 0,
        toolCount: 0,
        batchSize: 0,
      });
      return;
    }
    if (event.type === "tool_start") {
      if (typeof payload.id !== "string" || typeof payload.name !== "string") return;
      this.pending.set(payload.id, {
        timestamp,
        name: payload.name,
        turn: this.currentTurn,
        argPreview: summarizeToolArgs(payload.name, asRecord(payload.arguments)),
      });
      return;
    }
    if (event.type !== "tool_end" || typeof payload.id !== "string") return;
    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);
    this.tools.push({
      turn: pending.turn,
      tool: pending.name,
      success: typeof payload.error !== "string",
      durationMs: Math.max(0, timestamp - pending.timestamp),
      errorCategory: typeof payload.category === "string" ? payload.category : undefined,
      argPreview: pending.argPreview,
      batchSize: 1,
      outputChars: finiteNumber(asRecord(payload.meta).outputChars),
      visibleChars: finiteNumber(asRecord(payload.meta).visibleChars),
      truncated: typeof asRecord(payload.meta).truncated === "boolean"
        ? Boolean(asRecord(payload.meta).truncated)
        : undefined,
    });
  }

  finalize(endedAt = Date.now()): ToolTimeline {
    const toolsByTurn = new Map<number, number>();
    for (const tool of this.tools) {
      if (typeof tool.turn !== "number") continue;
      toolsByTurn.set(tool.turn, (toolsByTurn.get(tool.turn) ?? 0) + 1);
    }
    for (const tool of this.tools) {
      tool.batchSize = typeof tool.turn === "number" ? (toolsByTurn.get(tool.turn) ?? 1) : 1;
    }
    const turns = [...this.turnUsage.values()].map((turn) => ({
      ...turn,
      toolCount: toolsByTurn.get(turn.turn) ?? 0,
      batchSize: toolsByTurn.get(turn.turn) ?? 0,
    }));
    return {
      schemaVersion: TOOL_TIMELINE_SCHEMA_VERSION,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: Math.max(this.startedAt, endedAt),
      turns,
      tools: this.tools,
    };
  }
}

export async function persistToolTimeline(file: string, timeline: ToolTimeline): Promise<void> {
  const resolved = path.resolve(file);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(timeline)}\n`, { mode: 0o600 });
  await fs.rename(temporary, resolved);
}

export async function persistRedactedEventsJsonl(source: string, destination: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(source, "utf8");
  } catch {
    return false;
  }
  const lines = raw.split("\n").filter((line) => line.trim());
  const redacted = lines.map((line) => {
    try {
      return JSON.stringify(redactDeep(JSON.parse(line)));
    } catch {
      return JSON.stringify({ type: "invalid_event", payload: redact(truncateForLog(line, 400)) });
    }
  });
  const resolved = path.resolve(destination);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${redacted.join("\n")}${redacted.length ? "\n" : ""}`, { mode: 0o600 });
  await fs.rename(temporary, resolved);
  return true;
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(truncateForLog(value, 2_000));
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDeep(item)]),
    );
  }
  return value;
}
