import type { LlmProvider, Message } from "@ninjacode/providers";
import type { CodebaseIndexLike, DiagnosticsProvider, ToolContext } from "@ninjacode/tools";
import type { AgentEventHandler, ApprovalHandler, RunState } from "./types.js";
import type { PermissionEngine } from "./permissions.js";
import type { ToolCircuitBreaker } from "./reliability.js";
import type { HookRunResult } from "./hooks.js";
import {
  buildPersistedSession,
  loadSession,
  saveSession,
} from "./sessions.js";
import type { RequestCheckpoint, TurnTrace } from "./types.js";
import type { AgentFactory } from "./agentFactory.js";
import { runSubAgent } from "./subagents.js";
import { loadVerifyConfig, runVerification } from "./verify.js";
import { ToolPipeline } from "./toolPipeline.js";

function trackModifiedFiles(
  modifiedFiles: Set<string>,
  toolName: string,
  meta?: Record<string, unknown>,
): void {
  const writeTools = new Set(["write_file", "edit_file", "apply_patch", "delete_file"]);
  if (!writeTools.has(toolName)) return;
  if (Array.isArray(meta?.paths)) {
    for (const p of meta.paths) if (typeof p === "string") modifiedFiles.add(p);
  }
  if (typeof meta?.path === "string") modifiedFiles.add(meta.path);
}

export async function runCompletionVerification(opts: {
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  signal: AbortSignal;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  modifiedFiles: Set<string>;
  config: Awaited<ReturnType<typeof loadVerifyConfig>>;
}): Promise<{ ok: boolean; messages: string[] }> {
  const ctx: ToolContext = {
    workspaceRoot: opts.workspaceRoot,
    agentDir: opts.agentDir,
    sessionId: opts.sessionId,
    planId: opts.planId,
    signal: opts.signal,
    codebaseIndex: opts.codebaseIndex,
    diagnosticsProvider: opts.diagnosticsProvider,
  };
  return runVerification(ctx, opts.config, [...opts.modifiedFiles]);
}

export async function runVerificationSubAgent(opts: {
  provider: LlmProvider;
  workspaceRoot: string;
  agentDir: string;
  onEvent?: AgentEventHandler;
  signal: AbortSignal;
  modifiedFiles: Set<string>;
  answer: string;
  createAgent: AgentFactory;
}): Promise<string | undefined> {
  const diffSummary = [...opts.modifiedFiles].join(", ");
  const task = [
    "You are a verification sub-agent. Review the proposed solution adversarially.",
    `Modified files: ${diffSummary || "(none)"}`,
    `Proposed answer:\n${opts.answer.slice(0, 4000)}`,
    "List any bugs, missing tests, or incorrect assumptions. If none, reply exactly: LGTM",
  ].join("\n\n");
  const result = await runSubAgent({
    createAgent: opts.createAgent,
    provider: opts.provider,
    workspaceRoot: opts.workspaceRoot,
    agentDir: opts.agentDir,
    task,
    onEvent: opts.onEvent,
    signal: opts.signal,
    role: "verifier",
    toolAllowlist: ["read_file", "grep", "glob", "list_dir", "read_lints", "search_codebase"],
  });
  if (result.summary.trim() === "LGTM" || result.summary.toLowerCase().includes("lgtm")) {
    return undefined;
  }
  return result.summary;
}

export function createAgentToolPipeline(opts: {
  signal: AbortSignal;
  permissions: PermissionEngine;
  breaker: ToolCircuitBreaker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  codebaseIndex?: CodebaseIndexLike;
  diagnosticsProvider?: DiagnosticsProvider;
  onApproval?: ApprovalHandler;
  getState: () => RunState;
  setState: (next: RunState) => Promise<void>;
  runHooks: (
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ) => Promise<HookRunResult[]>;
  emit: (type: "tool_start" | "tool_end" | "approval_required" | "debug_hypotheses", payload: unknown) => Promise<void>;
  logAgentEvent: (type: "tool_call" | "tool_result" | "cancel", summary: string, detail?: string) => void;
  waitOrAbort: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  modifiedFiles: Set<string>;
}): ToolPipeline {
  return new ToolPipeline({
    ...opts,
    onModifiedFiles: (toolName, meta) => trackModifiedFiles(opts.modifiedFiles, toolName, meta),
  });
}

export async function writeAgentSession(opts: {
  persistSessions: boolean;
  permissions: PermissionEngine;
  agentDir: string;
  sessionId: string;
  workspaceRoot: string;
  mode: import("./types.js").AgentMode;
  model?: string;
  providerName: string;
  createdAt: string;
  planId: string;
  history: Message[];
  turns: TurnTrace[];
  pinnedTask?: string;
  requests: RequestCheckpoint[];
}): Promise<void> {
  if (!opts.persistSessions) return;
  const grants = [...(opts.permissions.getPolicy().grants ?? [])];
  const existing = await loadSession(opts.agentDir, opts.sessionId).catch(() => null);
  const planId = existing?.config.planId ?? opts.planId;
  const state = buildPersistedSession({
    config: {
      id: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      mode: opts.mode,
      model: opts.model,
      provider: opts.providerName.replace(/\+retry$/, ""),
      createdAt: opts.createdAt,
      planId,
    },
    history: opts.history,
    turns: opts.turns,
    grants,
    pinnedTask: opts.pinnedTask,
    title: existing?.title,
    pinned: existing?.pinned,
    archived: existing?.archived,
    requests: opts.requests,
  });
  await saveSession(opts.agentDir, state).catch(() => undefined);
}
