import type {
  CodebaseIndexLike,
  DiagnosticsProvider,
  Tool,
  ToolContext,
  ToolRegistry,
  SandboxMode,
} from "@ninjacode/tools";
import { ToolError } from "@ninjacode/tools";
import type { ToolCall } from "@ninjacode/providers";
import type { PermissionEngine } from "./permissions.js";
import { ToolCircuitBreaker } from "./reliability.js";
import { toolOutputLimit, truncateToolOutput } from "./context.js";
import { classifyToolFailure, toolMaxAttempts, validateToolArguments } from "./toolErrors.js";
import type { HookRunResult } from "./hooks.js";
import { SessionArtifactStore } from "./sessionArtifacts.js";
import { sessionEventLog } from "./sessionEventLog.js";
import { startSpan } from "./telemetry.js";
import type { ApprovalHandler, RunState, ToolInvocation } from "./types.js";
import { isWriteTool, postEditDiagnostics } from "./toolPipelineDiagnostics.js";
import {
  abortedInvocation,
  isParallelizableBatch,
  preflightToolCall,
  registryToolOrThrow,
  resolveToolApproval,
  safeGrantPolicy,
  safeGrantScopes,
  safeTarget,
} from "./toolPipelineHelpers.js";

interface ToolPipelineDeps {
  signal: AbortSignal;
  permissions: PermissionEngine;
  breaker: ToolCircuitBreaker;
  workspaceRoot: string;
  agentDir: string;
  sessionId: string;
  planId: string;
  sandboxMode: SandboxMode;
  persistSessionContext: boolean;
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
  logAgentEvent: (
    type: "tool_call" | "tool_result" | "cancel",
    summary: string,
    detail?: string,
  ) => void;
  waitOrAbort: <T>(promise: Promise<T>) => Promise<T>;
  isAbortError: (error: unknown) => boolean;
  onModifiedFiles: (toolName: string, meta?: Record<string, unknown>) => void;
}

interface ToolRunContext {
  tool: Tool;
  tc: ToolCall;
  target: string;
  approved: boolean;
  approvalWaitMs: number;
  execStarted: number;
}

export class ToolPipeline {
  constructor(private readonly deps: ToolPipelineDeps) {}

  async executeToolCalls(
    registry: ToolRegistry,
    toolCalls: ToolCall[],
  ): Promise<ToolInvocation[]> {
    if (this.deps.signal.aborted) {
      return toolCalls.map((tc) => abortedInvocation(tc));
    }

    if (isParallelizableBatch(registry, toolCalls) && toolCalls.length > 1) {
      return Promise.all(toolCalls.map((tc) => this.runToolCall(registry, tc)));
    }

    const invocations: ToolInvocation[] = [];
    for (const tc of toolCalls) {
      if (this.deps.signal.aborted) {
        invocations.push(abortedInvocation(tc));
        continue;
      }
      invocations.push(await this.runToolCall(registry, tc));
    }
    return invocations;
  }

  async runToolCall(registry: ToolRegistry, tc: ToolCall): Promise<ToolInvocation> {
    const started = Date.now();
    if (this.deps.signal.aborted) return abortedInvocation(tc);

    const preflight = preflightToolCall(tc, registry, this.deps.breaker, started);
    if (preflight) return preflight;

    const tool = registryToolOrThrow(registry, tc);
    try {
      validateToolArguments(tool, tc.arguments);
    } catch (error) {
      return this.preExecutionFailure(tc, error, started);
    }
    const target = safeTarget(tool, tc.arguments);
    const scopes = safeGrantScopes(tool, tc.arguments);
    const grantPolicy = safeGrantPolicy(tool, tc.arguments, scopes);

    const approval = await resolveToolApproval({
      deps: {
        permissions: this.deps.permissions,
        onApproval: this.deps.onApproval,
        getState: this.deps.getState,
        setState: this.deps.setState,
        waitOrAbort: this.deps.waitOrAbort,
        isAbortError: this.deps.isAbortError,
        emit: (type, payload) => this.deps.emit(type, payload),
      },
      tool,
      tc,
      target,
      scopes,
      grantPolicy,
      started,
    });
    if (approval.earlyReturn) return approval.earlyReturn;
    if (this.deps.signal.aborted) return abortedInvocation(tc);

    const blocked = await this.checkPreToolHooks(tool, tc, approval.approved, started);
    if (blocked) return blocked;

    return this.executeApprovedTool({
      tool,
      tc,
      target,
      approved: approval.approved,
      approvalWaitMs: approval.approvalWaitMs,
      execStarted: Date.now(),
    });
  }

  private preExecutionFailure(tc: ToolCall, error: unknown, started: number): ToolInvocation {
    const classified = classifyToolFailure(tc.name, error, tc.arguments);
    return {
      toolCall: tc,
      output: `Tool error [${classified.category}]: ${classified.message}\nRecovery: ${classified.recoveryHint}`,
      approved: false,
      durationMs: Date.now() - started,
      error: error instanceof ToolError ? error.code : classified.message,
      meta: { error: classified },
    };
  }

  private async checkPreToolHooks(
    tool: Tool,
    tc: ToolCall,
    approved: boolean,
    started: number,
  ): Promise<ToolInvocation | null> {
    const preHooks = await this.deps.runHooks("PreToolUse", { toolName: tool.name, arguments: tc.arguments });
    const preBlock = preHooks.find((r) => r.blocked);
    if (!preBlock) return null;
    return {
      toolCall: tc,
      output: `Blocked by PreToolUse hook: ${preBlock.stderr || preBlock.stdout || "no reason given"}`,
      approved,
      durationMs: Date.now() - started,
      error: "blocked_by_hook",
    };
  }

  private async executeApprovedTool(ctx: ToolRunContext): Promise<ToolInvocation> {
    this.deps.logAgentEvent(
      "tool_call",
      `${ctx.tool.name}(${ctx.target.slice(0, 80)})`,
      JSON.stringify(ctx.tc.arguments),
    );
    await this.deps.emit("tool_start", {
      id: ctx.tc.id,
      name: ctx.tool.name,
      arguments: ctx.tc.arguments,
      target: ctx.target,
    });

    const span = startSpan("tool", { tool: ctx.tool.name, risk: ctx.tool.risk });
    try {
      const execution = await this.executeWithRetry(ctx);
      const result = await this.handleToolSuccess(ctx, execution);
      span.end({ ok: !result.error, durationMs: result.durationMs });
      return result;
    } catch (e) {
      span.end({ failed: true });
      return this.handleToolFailure(ctx, e);
    }
  }

  private async executeWithRetry(ctx: ToolRunContext) {
    const maxAttempts = toolMaxAttempts(ctx.tool, ctx.tc.arguments);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.deps.signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await ctx.tool.execute(this.buildToolContext(), ctx.tc.arguments);
      } catch (error) {
        const classified = classifyToolFailure(ctx.tool.name, error, ctx.tc.arguments);
        if (!this.canRetryExecution(classified.category, classified.retryable, attempt, maxAttempts)) {
          throw error;
        }
        await this.waitBeforeRetry(attempt);
      }
    }
    throw new ToolError("Tool retry budget exhausted", "runtime");
  }

  private canRetryExecution(
    category: string,
    retryable: boolean,
    attempt: number,
    maxAttempts: number,
  ): boolean {
    if (this.deps.signal.aborted || !retryable || attempt >= maxAttempts) return false;
    return category === "Timeout" || category === "ProviderError" || category === "UnexpectedEnvironment";
  }

  private async waitBeforeRetry(attempt: number): Promise<void> {
    const delayMs = Math.min(1_000, 100 * 2 ** (attempt - 1));
    await this.deps.waitOrAbort(new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  private buildToolContext(): ToolContext {
    return {
      workspaceRoot: this.deps.workspaceRoot,
      agentDir: this.deps.agentDir,
      sessionId: this.deps.sessionId,
      planId: this.deps.planId,
      sandboxMode: this.deps.sandboxMode,
      signal: this.deps.signal,
      codebaseIndex: this.deps.codebaseIndex,
      diagnosticsProvider: this.deps.diagnosticsProvider,
    };
  }

  private async handleToolSuccess(
    ctx: ToolRunContext,
    result: Awaited<ReturnType<Tool["execute"]>>,
  ): Promise<ToolInvocation> {
    const artifactId = await this.archiveToolOutput(ctx, result.output, result.meta);
    this.deps.breaker.recordSuccess(ctx.tool.name);
    this.deps.onModifiedFiles(ctx.tool.name, result.meta);

    let output = result.output;
    if (isWriteTool(ctx.tool.name)) {
      const diagNote = await postEditDiagnostics(this.buildToolContext(), result.meta);
      if (diagNote) output = `${output}\n\n${diagNote}`;
    }

    await this.deps.emit("tool_end", {
      id: ctx.tc.id,
      name: ctx.tool.name,
      output: truncateToolOutput(output, toolOutputLimit(ctx.tool.name)),
      meta: result.meta,
    });
    this.deps.logAgentEvent("tool_result", `${ctx.tool.name}: ok (${output.length} chars)`, output);

    if (ctx.tool.name === "record_hypotheses" && result.meta?.hypotheses) {
      await this.deps.emit("debug_hypotheses", { hypotheses: result.meta.hypotheses });
    }
    await this.deps.runHooks("PostToolUse", {
      toolName: ctx.tool.name,
      arguments: ctx.tc.arguments,
      output,
    });

    return {
      toolCall: ctx.tc,
      output,
      approved: ctx.approved,
      durationMs: Date.now() - ctx.execStarted,
      approvalWaitMs: ctx.approvalWaitMs || undefined,
      artifactId,
      meta: result.meta,
    };
  }

  private async archiveToolOutput(
    ctx: ToolRunContext,
    output: string,
    meta?: Record<string, unknown>,
  ): Promise<string | undefined> {
    if (!this.deps.persistSessionContext) return undefined;
    const artifact = await new SessionArtifactStore(
      this.deps.agentDir,
      this.deps.sessionId,
    ).putText(output, {
      kind: ctx.tool.name.startsWith("mcp_") ? "mcp_output" : "tool_output",
      toolName: ctx.tool.name,
      toolCallId: ctx.tc.id,
    });
    await sessionEventLog(this.deps.agentDir, this.deps.sessionId).append("tool_result", {
      toolCallId: ctx.tc.id,
      toolName: ctx.tool.name,
      artifactId: artifact.id,
      byteLength: artifact.byteLength,
      approved: ctx.approved,
      meta: meta ?? {},
    });
    return artifact.id;
  }

  private async handleToolFailure(ctx: ToolRunContext, e: unknown): Promise<ToolInvocation> {
    if (this.deps.signal.aborted || this.deps.isAbortError(e)) {
      this.deps.logAgentEvent("cancel", `${ctx.tool.name}: aborted by user`);
      await this.deps.emit("tool_end", {
        id: ctx.tc.id,
        name: ctx.tool.name,
        error: "aborted",
      });
      return {
        toolCall: ctx.tc,
        output: "Tool call aborted by user.",
        approved: ctx.approved,
        durationMs: Date.now() - ctx.execStarted,
        error: "aborted",
      };
    }

    const classified = classifyToolFailure(ctx.tool.name, e, ctx.tc.arguments);
    const message = classified.message;
    const artifactId = await this.archiveToolOutput(ctx, message, {
      error: true,
      category: classified.category,
      retryable: classified.retryable,
      blame: classified.blame,
      recoveryHint: classified.recoveryHint,
    });
    this.deps.breaker.recordFailure(ctx.tool.name);
    await this.deps.emit("tool_end", {
      id: ctx.tc.id,
      name: ctx.tool.name,
      error: message,
      category: classified.category,
      retryable: classified.retryable,
      blame: classified.blame,
      recoveryHint: classified.recoveryHint,
    });
    this.deps.logAgentEvent("tool_result", `${ctx.tool.name}: error [${classified.category}]`, message);
    await this.deps.runHooks("PostToolUse", {
      toolName: ctx.tool.name,
      arguments: ctx.tc.arguments,
      error: message,
    });

    return {
      toolCall: ctx.tc,
      output: `Tool error [${classified.category}]: ${message}\nRecovery: ${classified.recoveryHint}`,
      approved: ctx.approved,
      durationMs: Date.now() - ctx.execStarted,
      artifactId,
      error: message,
      meta: { error: classified },
    };
  }
}
