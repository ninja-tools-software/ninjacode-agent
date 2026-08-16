import fs from "node:fs/promises";
import type { Message } from "@ninjacode/providers";
import type { ToolRegistry } from "@ninjacode/tools";
import { estimateContextForSession } from "./agentContextEstimate.js";
import { compactAgentHistory } from "./agentCompact.js";
import type { CompactionInfo } from "./context.js";
import { redact, truncateForLog } from "./agentLogs.js";
import type { AgentTaskInput } from "./agentOptions.js";
import type { ContextUsageBreakdown } from "./contextEstimate.js";
import type { SkillDefinition } from "./skills.js";
import type { AgentMode, CheckpointFailure } from "./types.js";

export async function previewAgentContextUsage(opts: {
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  history: Message[];
  tools: ToolRegistry;
  contextWindow?: number;
  maxTokens: number;
  providerName: string;
  model?: string;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): Promise<ContextUsageBreakdown> {
  return estimateContextForSession(opts);
}

export async function compactAgentSession(opts: {
  history: Message[];
  pinnedTask?: string;
  provider: import("@ninjacode/providers").LlmProvider;
  model?: string;
  utilityModel?: string;
  contextWindow?: number;
  workspaceRoot: string;
  agentDir: string;
  mode: AgentMode;
  skills: SkillDefinition[];
  tools: ToolRegistry;
  maxTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  onCompaction: (info: CompactionInfo) => Promise<void>;
  onUsage: (usage: ContextUsageBreakdown) => Promise<void>;
}): Promise<{ compacted: Message[]; usage: ContextUsageBreakdown } | null> {
  const result = await compactAgentHistory(opts);
  if (!result) return null;
  return { compacted: result.compacted, usage: result.usage };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function reportCheckpointFailure(
  emit: (failure: CheckpointFailure) => Promise<void>,
  stage: CheckpointFailure["stage"],
  error: unknown,
): Promise<void> {
  await emit({ stage, message: errorMessage(error) }).catch(() => undefined);
}

export async function prepareAgentRun(opts: {
  agentDir: string;
  enableCheckpoints: boolean;
  checkpoints: {
    init: () => Promise<void>;
    create: (label: string, meta: { sessionId: string }) => Promise<{ id: string } | null>;
  };
  requestsLength: number;
  sessionId: string;
  task: AgentTaskInput;
  emitCheckpoint: (cp: { id: string }) => Promise<void>;
  emitCheckpointFailure: (failure: CheckpointFailure) => Promise<void>;
}): Promise<{ requestSeq: number; pendingCheckpointId?: string }> {
  await fs.mkdir(opts.agentDir, { recursive: true });
  const requestSeq = opts.requestsLength + 1;
  if (!opts.enableCheckpoints) return { requestSeq };

  try {
    await opts.checkpoints.init();
  } catch (error) {
    await reportCheckpointFailure(opts.emitCheckpointFailure, "init", error);
    return { requestSeq };
  }
  const preview = opts.task.text.replace(/\s+/g, " ").trim().slice(0, 60);
  let cp: { id: string } | null;
  try {
    cp = await opts.checkpoints.create(
      `request-${requestSeq}${preview ? `: ${preview}` : ""}`,
      { sessionId: opts.sessionId },
    );
  } catch (error) {
    await reportCheckpointFailure(opts.emitCheckpointFailure, "create", error);
    return { requestSeq };
  }
  if (!cp) return { requestSeq };
  try {
    await opts.emitCheckpoint(cp);
  } catch (error) {
    await reportCheckpointFailure(opts.emitCheckpointFailure, "emit", error);
  }
  return { requestSeq, pendingCheckpointId: cp.id };
}

export function logAgentEventEntry(opts: {
  sessionId: string;
  emit: (type: "agent_log", payload: unknown) => Promise<void>;
  type: "llm_call" | "llm_response" | "tool_call" | "tool_result" | "cache" | "cancel" | "error";
  summary: string;
  detail?: string;
  meta?: Record<string, unknown>;
}): void {
  void opts.emit("agent_log", {
    timestamp: new Date().toISOString(),
    sessionId: opts.sessionId,
    type: opts.type,
    summary: redact(truncateForLog(opts.summary, 300)),
    detail: opts.detail ? redact(truncateForLog(opts.detail)) : undefined,
    meta: opts.meta,
  });
}
