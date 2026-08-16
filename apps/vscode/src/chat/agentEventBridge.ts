import * as vscode from "vscode";
import {
  toolOutputLimit,
  truncateToolOutput,
  type AgentLogEntry,
  type AgentMode,
  type Checkpoint,
  type CheckpointFailure,
  type RunState,
} from "@ninjacode/core";
import { t } from "../locale.js";
import type { GatewayErrorInfo, HostToWebview } from "../protocol.js";
import type { ProposedEditsStore } from "../proposedEdits.js";
import type { SessionRuntimeManager } from "../sessionRuntime.js";
import { formatArgsPreview, formatToolLineRange, inferToolTarget, isInteractiveUserTool, toolLabel } from "../toolUi.js";
import { recordAppliedEditsFromTool } from "./appliedEdits.js";
import { addTurnUsage, type TurnTokenUsage } from "./sessionUsage.js";

/** A raw event emitted by the agent loop. */
export interface AgentEvent {
  type: string;
  payload: unknown;
}

function checkpointStageText(stage: CheckpointFailure["stage"]): string {
  switch (stage) {
    case "init":
      return t("initialization");
    case "create":
      return t("creation");
    case "emit":
      return t("notification");
  }
}

/** Correlates `tool_start` / `tool_end` pairs so a card can be updated in place. */
class ToolCallTracker {
  private readonly seq = new Map<string, number>();
  private readonly pending = new Map<string, string[]>();
  private readonly startedAt = new Map<string, number>();

  next(sessionId: string): string {
    const n = (this.seq.get(sessionId) ?? 0) + 1;
    this.seq.set(sessionId, n);
    const id = `${sessionId}-t${n}`;
    const stack = this.pending.get(sessionId) ?? [];
    stack.push(id);
    this.pending.set(sessionId, stack);
    this.startedAt.set(id, Date.now());
    return id;
  }

  pop(sessionId: string): { id: string; durationMs?: number } {
    const stack = this.pending.get(sessionId) ?? [];
    const id = stack.shift();
    this.pending.set(sessionId, stack);
    if (!id) return { id: `${sessionId}-unknown-${Date.now()}` };
    const started = this.startedAt.get(id);
    if (started !== undefined) this.startedAt.delete(id);
    return { id, durationMs: started !== undefined ? Date.now() - started : undefined };
  }
}

interface AgentEventBridgeDeps {
  post(sessionId: string, payload: HostToWebview): void;
  runtimes: SessionRuntimeManager;
  proposedEdits: ProposedEditsStore;
  logAgentEntry(sessionId: string, entry: AgentLogEntry): void;
  refreshTodos(sessionId: string): void;
  refreshScratchpad(sessionId: string): void;
  syncTodosIntoPlan(sessionId: string): void;
  openPlanEditor(): void;
  pushPlansList(sessionId: string): void;
  syncPlanEditor(): void;
  markCompacted(sessionId: string): void;
  /** True when the chat webview is visible for this session. */
  isShowing(sessionId: string): boolean;
  /** Offline toast for gateway errors when the chat is not visible. */
  notifyGatewayError?(sessionId: string, info: GatewayErrorInfo): void;
}

/**
 * Translates agent loop events into webview messages. One method per event family
 * keeps each unit small; `handle` is just the dispatch table.
 */
export class AgentEventBridge {
  private readonly tools = new ToolCallTracker();
  private readonly gatewayErrors = new Map<string, GatewayErrorInfo>();
  private readonly dispatch: Record<string, (sessionId: string, payload: unknown) => void>;

  constructor(private readonly deps: AgentEventBridgeDeps) {
    this.dispatch = {
      text_delta: (sid, p) =>
        this.deps.post(sid, { type: "assistant_delta", text: (p as { text: string }).text }),
      reasoning_delta: (sid, p) =>
        this.deps.post(sid, { type: "reasoning_delta", text: (p as { text: string }).text }),
      routing: (sid, p) => {
        const r = p as {
          model: string;
          label?: string;
          reason?: string;
          tier?: string;
          estimatedCredits?: number;
        };
        this.deps.post(sid, {
          type: "routing",
          model: r.model,
          label: r.label,
          reason: r.reason,
          tier: r.tier,
          estimatedCredits: r.estimatedCredits,
        });
      },
      thinking: (sid) => this.deps.post(sid, { type: "status", text: "Thinking…" }),
      tool_start: (sid, p) => this.onToolStart(sid, p as ToolStartPayload),
      tool_end: (sid, p) => this.onToolEnd(sid, p as ToolEndPayload),
      debug_hypotheses: (sid, p) =>
        this.deps.post(sid, { type: "debug_hypotheses", hypotheses: (p as { hypotheses: [] }).hypotheses }),
      debug_log: (sid, p) =>
        this.deps.post(sid, { type: "debug_log", count: (p as { count?: number }).count ?? 0 }),
      status: (sid, p) => {
        const text = (p as { text?: string }).text;
        if (text) this.deps.post(sid, { type: "status", text });
      },
      checkpoint: (sid, p) => this.onCheckpoint(sid, p as Checkpoint),
      checkpoint_error: (sid, p) => this.onCheckpointFailure(sid, p as CheckpointFailure),
      error: (sid, p) => this.onError(sid, p as { message: string; gateway?: GatewayErrorInfo }),
      context_usage: (sid, p) =>
        this.deps.post(sid, {
          type: "context_usage",
          ...(p as Omit<Extract<HostToWebview, { type: "context_usage" }>, "type">),
        }),
      usage: (sid, p) => this.onUsage(sid, (p as { usage: TurnTokenUsage }).usage),
      compaction: (sid, p) => this.onCompaction(sid, p as { trigger: string; messagesSummarized: number }),
      state_change: (sid, p) => this.onStateChange(sid, (p as { state: RunState }).state),
      agent_log: (sid, p) => this.deps.logAgentEntry(sid, p as AgentLogEntry),
      hook_run: (sid, p) => this.onHookRun(sid, p as HookRunPayload),
    };
  }

  handle(sessionId: string, ev: AgentEvent): void {
    this.dispatch[ev.type]?.(sessionId, ev.payload);
  }

  /** Consume a gateway error posted for this session during the current run (dedup). */
  consumeGatewayError(sessionId: string): GatewayErrorInfo | undefined {
    const info = this.gatewayErrors.get(sessionId);
    this.gatewayErrors.delete(sessionId);
    return info;
  }

  private onError(sessionId: string, p: { message: string; gateway?: GatewayErrorInfo }): void {
    if (p.gateway) {
      this.gatewayErrors.set(sessionId, p.gateway);
      this.deps.post(sessionId, { type: "gateway_error", info: p.gateway });
      if (!this.deps.isShowing(sessionId)) {
        this.deps.notifyGatewayError?.(sessionId, p.gateway);
      }
      return;
    }
    this.deps.post(sessionId, { type: "error", text: p.message });
  }

  private onToolStart(sessionId: string, p: ToolStartPayload): void {
    const args = p.arguments;
    const target = p.target ?? inferToolTarget(args);
    const id = this.tools.next(sessionId);
    if (isInteractiveUserTool(p.name)) return;
    this.deps.post(sessionId, {
      type: "tool",
      id,
      name: p.name,
      target,
      label: toolLabel(p.name, target, args),
      status: "running",
      argsPreview: formatArgsPreview(args),
      arguments: args,
      lineRange: formatToolLineRange(p.name, args),
    });
  }

  private onToolEnd(sessionId: string, p: ToolEndPayload): void {
    const { id, durationMs } = this.tools.pop(sessionId);
    if (!isInteractiveUserTool(p.name)) {
      this.deps.post(sessionId, {
        type: "tool",
        id,
        name: p.name,
        status: p.error ? "error" : "done",
        output: p.output
          ? truncateToolOutput(p.output, toolOutputLimit(p.name))
          : undefined,
        error: p.error,
        durationMs,
        lineRange: formatToolLineRange(p.name, undefined, p.meta),
      });
    }
    if (p.name === "record_hypotheses" && Array.isArray(p.meta?.hypotheses)) {
      this.deps.post(sessionId, { type: "debug_hypotheses", hypotheses: p.meta.hypotheses });
    }
    if (p.name === "todo_write") {
      this.deps.refreshTodos(sessionId);
      this.deps.syncTodosIntoPlan(sessionId);
    }
    if (p.name === "write_plan") {
      this.deps.refreshScratchpad(sessionId);
      this.deps.syncTodosIntoPlan(sessionId);
      this.deps.pushPlansList(sessionId);
      const mode = vscode.workspace.getConfiguration("ninjacode").get<AgentMode>("mode");
      if (mode === "plan") this.deps.openPlanEditor();
    }
    recordAppliedEditsFromTool({
      edits: this.deps.proposedEdits,
      sessionId,
      toolName: p.name,
      meta: p.meta,
      hadError: Boolean(p.error),
    });
  }

  private onUsage(sessionId: string, usage: TurnTokenUsage | undefined): void {
    if (!usage) return;
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    const runtime = this.deps.runtimes.getOrCreate(sessionId);
    const next = addTurnUsage(runtime.ui.sessionUsage, usage, {
      provider: cfg.get<string>("provider"),
      model: cfg.get<string>("model"),
    });
    this.deps.post(sessionId, { type: "usage", ...next });
  }

  private onCheckpoint(sessionId: string, cp: Checkpoint): void {
    this.deps.runtimes.getOrCreate(sessionId).checkpoints.push(cp);
    this.deps.post(sessionId, { type: "checkpoint", id: cp.id, label: cp.label });
    this.deps.post(sessionId, { type: "status", text: `⊕ checkpoint ${cp.label}` });
  }

  private onCheckpointFailure(sessionId: string, failure: CheckpointFailure): void {
    this.deps.post(sessionId, {
      type: "status",
      text: t(
        "Checkpoint {0} failed: {1}. The run will continue without this checkpoint.",
        checkpointStageText(failure.stage),
        failure.message,
      ),
    });
  }

  private onCompaction(sessionId: string, info: { trigger: string; messagesSummarized: number }): void {
    this.deps.markCompacted(sessionId);
    this.deps.post(sessionId, {
      type: "status",
      text: `⋯ compacted ${info.messagesSummarized} message(s) (${info.trigger})`,
    });
  }

  private onStateChange(sessionId: string, state: RunState): void {
    this.deps.runtimes.setRunState(sessionId, state);
    this.deps.post(sessionId, { type: "run_state", state });
    this.deps.syncPlanEditor();
    if (state !== "stopped" && state !== "failed" && state !== "completed") return;
    const cancelled = this.deps.runtimes.cancelAllPending(sessionId);
    for (const requestId of cancelled.approvals) {
      this.deps.post(sessionId, {
        type: "approval_resolved",
        requestId,
        approved: false,
        cancelled: true,
      });
    }
    for (const requestId of cancelled.questions) {
      this.deps.post(sessionId, { type: "question_resolved", requestId, cancelled: true });
    }
    for (const requestId of cancelled.userActions) {
      this.deps.post(sessionId, { type: "user_action_resolved", requestId, cancelled: true });
    }
  }

  private onHookRun(sessionId: string, r: HookRunPayload): void {
    const outcome = r.blocked
      ? `blocked: ${r.stderr?.trim() || "no reason given"}`
      : `exit ${r.exitCode ?? 0}`;
    this.deps.post(sessionId, { type: "status", text: `⚓ hook ${r.event} (${r.command}) — ${outcome}` });
  }
}

interface ToolStartPayload {
  name: string;
  target?: string;
  arguments?: Record<string, unknown>;
}

interface ToolEndPayload {
  name: string;
  error?: string;
  output?: string;
  meta?: Record<string, unknown>;
}

interface HookRunPayload {
  event: string;
  command: string;
  ran: boolean;
  blocked: boolean;
  exitCode?: number;
  stderr?: string;
}
