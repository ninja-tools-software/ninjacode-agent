import path from "node:path";
import type { Message } from "@ninjacode/providers";
import { estimateContextForSession } from "./agentContextEstimate.js";
import { initAgent } from "./agentInit.js";
import {
  buildAgentTurnHost,
  buildRunLoopPrepareInput,
  createRunToolPipeline,
} from "./agentHostWiring.js";
import {
  compactAgentSession,
  logAgentEventEntry,
  prepareAgentRun,
  previewAgentContextUsage,
} from "./agentLifecycle.js";
import { type AgentOptions, type AgentTaskInput } from "./agentOptions.js";
import { applySavedSession } from "./agentResume.js";
import { runAgentMainLoop } from "./agentRunWiring.js";
import { setupAgentHooks, setupAgentSkills, startAgentDebugServer } from "./agentSetup.js";
import {
  classifyAgentStopReason,
  isAbortError,
  isTimeoutAbortReason,
  linkExternalAbortSignal,
  trackTokenUsage,
  waitOrAbort,
} from "./agentRuntime.js";
import { writeAgentSession } from "./agentSupport.js";
import { buildHostBindingSource, type AgentConfig, type AgentRuntime } from "./agentState.js";
import type { HookRunResult } from "./hooks.js";
import { loadSession, loadSessionSafe, type PersistedSession } from "./sessions.js";
import { sessionEventLog } from "./sessionEventLog.js";
import { prepareLegacySessionContext } from "./sessionMigration.js";
import { SessionArtifactStore } from "./sessionArtifacts.js";
import type { AgentFactory } from "./agentFactory.js";
import type {
  AgentEventHandler,
  AgentOutcome,
  RunState,
  SessionState,
} from "./types.js";
import type { ContextUsageBreakdown } from "./contextEstimate.js";
import { startSpan } from "./telemetry.js";
import { persistTrajectory, TrajectoryRecorder } from "./trajectory.js";
import { DebouncedSessionPersistence } from "./sessionPersistence.js";

export type {
  AgentOptions,
  AgentTaskInput,
  IndependentVerifierOptions,
  PerformanceOptions,
  ResolvedIndependentVerifierOptions,
  ResolvedPerformanceOptions,
  SubAgentGovernanceOptions,
  VerificationMode,
} from "./agentOptions.js";

export const createSubAgent: AgentFactory = (opts) =>
  new Agent({ ...opts, persistSessions: false, enableSubagents: false });

export class Agent {
  private readonly config: AgentConfig;
  private readonly sessionPersistence: DebouncedSessionPersistence;
  private runtime: AgentRuntime;
  private trajectoryRecorder?: TrajectoryRecorder;

  constructor(opts: AgentOptions) {
    const externalOnEvent = opts.onEvent;
    const initialized = initAgent({
      ...opts,
      onEvent: async (event) => {
        this.trajectoryRecorder?.recordAgentEvent(event);
        await externalOnEvent?.(event);
      },
    }, createSubAgent);
    this.config = initialized.config;
    this.runtime = initialized.runtime;
    this.sessionPersistence = new DebouncedSessionPersistence(
      this.config.performance.asyncSessionPersistence
        ? this.config.performance.persistenceDebounceMs
        : 0,
    );
  }

  abort(reason?: unknown): void {
    if (this.runtime.controller.signal.aborted) return;
    const abortReason = reason ?? new DOMException("Aborted by user", "AbortError");
    this.runtime.controller.abort(abortReason);
    this.logAgentEvent(
      "cancel",
      isTimeoutAbortReason(abortReason) ? "Run timed out." : "Run aborted by user.",
    );
    if (this.runtime.state === "running" || this.runtime.state === "waiting") {
      void this.persist(true).finally(async () => {
        if (this.runtime.state === "running" || this.runtime.state === "waiting") {
          await this.setState("stopping");
        }
      });
    }
  }

  /** Flush durable state and stop outstanding work before a host shuts down. */
  async shutdown(reason?: unknown): Promise<void> {
    this.abort(reason ?? new DOMException("Agent shutdown", "AbortError"));
    await this.persist(true);
    if (this.runtime.state !== "completed" && this.runtime.state !== "failed") {
      await this.setState("stopped");
    }
  }

  getState(): RunState {
    return this.runtime.state;
  }

  getSession(): SessionState {
    return {
      config: {
        id: this.config.sessionId,
        workspaceRoot: this.config.workspaceRoot,
        mode: this.config.mode,
        model: this.config.model,
        createdAt: this.config.createdAt,
      },
      history: this.runtime.history,
      turns: this.runtime.turns,
    };
  }

  getCacheStats() {
    return { ...this.runtime.cacheStats, ...this.config.budget.snapshot() };
  }

  static estimateContextForSession = estimateContextForSession;

  async previewContextUsage(): Promise<ContextUsageBreakdown> {
    return previewAgentContextUsage({
      workspaceRoot: this.config.workspaceRoot,
      agentDir: this.config.agentDir,
      mode: this.config.mode,
      history: this.runtime.history,
      tools: this.config.tools,
      contextWindow: this.config.contextWindow,
      maxTokens: this.config.maxTokens,
      providerName: this.config.provider.name,
      model: this.config.model,
      cacheReadTokens: this.runtime.cacheStats.cacheReadTokens,
      cacheWriteTokens: this.runtime.cacheStats.cacheWriteTokens,
    });
  }

  async compact(): Promise<ContextUsageBreakdown | null> {
    const result = await compactAgentSession({
      history: this.runtime.history,
      pinnedTask: this.runtime.pinnedTask,
      provider: this.config.provider,
      model: this.config.model,
      utilityModel: this.config.utilityModel,
      contextWindow: this.config.contextWindow,
      workspaceRoot: this.config.workspaceRoot,
      agentDir: this.config.agentDir,
      mode: this.config.mode,
      skills: this.runtime.skills,
      tools: this.config.tools,
      maxTokens: this.config.maxTokens,
      cacheReadTokens: this.runtime.cacheStats.cacheReadTokens,
      cacheWriteTokens: this.runtime.cacheStats.cacheWriteTokens,
      onCompaction: async (info) => {
        if (info.usage) {
          trackTokenUsage(this.config.budget, this.runtime.cacheStats, info.usage, {
            category: "compaction",
            model: info.model,
          });
          await this.emit("usage", {
            usage: info.usage,
            model: info.model,
            category: "compaction",
          });
        }
        if (this.config.persistSessions) {
          const artifact = await new SessionArtifactStore(
            this.config.agentDir,
            this.config.sessionId,
          ).putText(JSON.stringify(this.runtime.history), {
            kind: "compaction_segment",
            mimeType: "application/json",
          });
          await sessionEventLog(this.config.agentDir, this.config.sessionId).append(
            "compaction",
            { info, artifactId: artifact.id },
          );
        }
        await this.emit("compaction", info);
      },
      onUsage: (usage) => this.emit("context_usage", usage),
    });
    if (!result) return null;
    this.runtime.history = result.compacted;
    await this.persist();
    return result.usage;
  }

  getCheckpointManager() {
    return this.config.checkpoints;
  }

  getDebugServer() {
    return this.runtime.debugServer;
  }

  getDebugSession() {
    return this.runtime.debugSession;
  }

  getSkills() {
    return this.runtime.skills;
  }

  static async resume(opts: AgentOptions & { sessionId: string }) {
    const agentDir = opts.agentDir ?? path.join(path.resolve(opts.workspaceRoot), ".ninjacode");
    const loaded = await loadSessionSafe(agentDir, opts.sessionId);
    if (!loaded) throw new Error(`Session not found: ${opts.sessionId}`);
    const saved = await prepareLegacySessionContext(agentDir, loaded);
    const agent = new Agent({ ...opts, sessionId: opts.sessionId });
    applySavedSession(agent.runtime, agent.config, saved);
    return { agent, prior: agent.runtime.history };
  }

  async run(task: string | AgentTaskInput, prior: Message[] = []): Promise<AgentOutcome> {
    const normalizedTask: AgentTaskInput = typeof task === "string" ? { text: task } : task;
    this.runtime.controller = new AbortController();
    this.runtime.modifiedFiles.clear();
    this.runtime.toolCallFingerprints = [];
    this.runtime.pendingCheckpointId = undefined;
    this.runtime.runStartedAt = Date.now();
    this.trajectoryRecorder =
      this.config.trajectory?.enabled === true
        ? new TrajectoryRecorder({
            sessionId: this.config.sessionId,
            startedAt: this.runtime.runStartedAt,
            traceId: this.config.trajectory.traceId,
            runId: this.config.trajectory.runId,
          })
        : undefined;
    linkExternalAbortSignal(this.config.externalSignal, this.runtime.controller, (reason) => this.abort(reason));
    await this.setState("running");
    if (this.config.persistSessions) {
      await sessionEventLog(this.config.agentDir, this.config.sessionId).append("user_message", {
        text: normalizedTask.text,
        images: normalizedTask.images ?? [],
      });
    }

    // A checkpoint must never get ahead of the latest resumable session snapshot.
    await this.flushPersistence();
    const prepared = await prepareAgentRun({
      agentDir: this.config.agentDir,
      enableCheckpoints: this.config.enableCheckpoints,
      checkpoints: this.config.checkpoints,
      requestsLength: this.runtime.requests.length,
      sessionId: this.config.sessionId,
      task: normalizedTask,
      emitCheckpoint: (cp) => this.emit("checkpoint", cp),
      emitCheckpointFailure: (failure) => this.emit("checkpoint_error", failure),
    });
    this.runtime.requestSeq = prepared.requestSeq;
    this.runtime.pendingCheckpointId = prepared.pendingCheckpointId;

    const debugLogUrl = this.config.mode === "debug" ? await this.startDebugServer() : undefined;
    const span = startSpan("run", {
      sessionId: this.config.sessionId,
      mode: this.config.mode,
      sandbox: this.config.sandboxMode,
    });
    const timeoutTimer =
      this.config.runTimeoutMs > 0
        ? setTimeout(() => {
            this.abort(
              new DOMException(
                `Run timeout exceeded (${Math.round(this.config.runTimeoutMs / 1000)}s).`,
                "TimeoutError",
              ),
            );
          }, this.config.runTimeoutMs)
        : undefined;
    try {
      const outcome = await this.runLoop(normalizedTask, prior, debugLogUrl);
      span.end({ completed: outcome.completed, turns: outcome.turns.length });
      if (outcome.trajectory && this.config.trajectory?.persistPath) {
        await persistTrajectory(this.config.trajectory.persistPath, outcome.trajectory);
      }
      return outcome;
    } catch (error) {
      this.trajectoryRecorder?.recordAgentEvent({
        type: "error",
        payload: { category: "run_error" },
      });
      span.end({ failed: true });
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      await this.persist(true);
      if (this.runtime.debugServer) {
        await this.runtime.debugServer.stop().catch(() => undefined);
        this.runtime.debugServer = null;
      }
    }
  }

  async loadPersisted(): Promise<PersistedSession | null> {
    return loadSession(this.config.agentDir, this.config.sessionId);
  }

  private hostCallbacks() {
    return {
      runHooks: (event: HookRunResult["event"], input: Parameters<Agent["runHooks"]>[1]) =>
        this.runHooks(event, input),
      persist: () => this.persist(),
      setState: (next: RunState) => this.setState(next),
      emit: (type: Parameters<AgentEventHandler>[0]["type"], payload: unknown) => this.emit(type, payload),
      logAgentEvent: (
        type: Parameters<Agent["logAgentEvent"]>[0],
        summary: string,
        detail?: string,
      ) => this.logAgentEvent(type, summary, detail),
      outcome: (answer: string, completed: boolean) => this.outcome(answer, completed),
      abortRun: (reason: unknown) => this.abort(reason),
    };
  }

  private async setState(next: RunState): Promise<void> {
    if (this.runtime.state === next) return;
    if (
      next === "stopping" ||
      next === "stopped" ||
      next === "completed" ||
      next === "failed"
    ) {
      await this.flushPersistence();
    }
    const previous = this.runtime.state;
    this.runtime.state = next;
    await this.emit("state_change", { state: next, previous });
  }

  private async setupHooks(): Promise<void> {
    await setupAgentHooks({
      workspaceRoot: this.config.workspaceRoot,
      agentDir: this.config.agentDir,
      sandboxMode: this.config.sandboxMode,
      permissions: this.config.permissions,
      onApproval: this.config.onApproval,
      enableWorkspaceHooks: this.config.enableWorkspaceHooks,
      setHookRunner: (runner) => {
        this.runtime.hookRunner = runner;
      },
    });
  }

  private async setupSkills(): Promise<void> {
    await setupAgentSkills({
      workspaceRoot: this.config.workspaceRoot,
      tools: this.config.tools,
      provider: this.config.provider,
      agentDir: this.config.agentDir,
      createSubAgent,
      onEvent: this.config.onEvent,
      setSkills: (skills) => {
        this.runtime.skills = skills;
      },
    });
  }

  private logAgentEvent(
    type: "llm_call" | "llm_response" | "tool_call" | "tool_result" | "cache" | "cancel" | "error",
    summary: string,
    detail?: string,
    meta?: Record<string, unknown>,
  ): void {
    logAgentEventEntry({
      sessionId: this.config.sessionId,
      emit: (eventType, payload) => this.emit(eventType, payload),
      type,
      summary,
      detail,
      meta,
    });
  }

  private async runHooks(
    event: HookRunResult["event"],
    input: { toolName?: string; arguments?: Record<string, unknown>; output?: string; error?: string },
  ): Promise<HookRunResult[]> {
    if (!this.runtime.hookRunner?.enabled) return [];
    const results = await this.runtime.hookRunner.run(
      { event, sessionId: this.config.sessionId, ...input },
      this.runtime.controller.signal,
    );
    for (const r of results) if (r.ran) await this.emit("hook_run", r);
    return results;
  }

  private async startDebugServer(): Promise<string> {
    return startAgentDebugServer({
      agentDir: this.config.agentDir,
      setDebugSession: (session) => {
        this.runtime.debugSession = session;
      },
      setDebugServer: (server) => {
        this.runtime.debugServer = server;
      },
      emitStatus: (text) => this.emit("status", { text }),
      emitDebugLog: (entry, count) => this.emit("debug_log", { entry, count }),
    });
  }

  private newRunToolPipeline() {
    return createRunToolPipeline({
      signal: this.runtime.controller.signal,
      permissions: this.config.permissions,
      breaker: this.config.breaker,
      workspaceRoot: this.config.workspaceRoot,
      agentDir: this.config.agentDir,
      sessionId: this.config.sessionId,
      planId: this.runtime.planId,
      sandboxMode: this.config.sandboxMode,
      persistSessionContext: this.config.persistSessions,
      parallelToolReads:
        this.config.performance.parallelToolReads &&
        !this.runtime.hookRunner?.enabled,
      codebaseIndex: this.config.codebaseIndex,
      diagnosticsProvider: this.config.diagnosticsProvider,
      onApproval: this.config.onApproval,
      getState: () => this.runtime.state,
      setState: (next) => this.setState(next),
      runHooks: (event, input) => this.runHooks(event, input),
      emit: this.config.onEvent,
      logAgentEvent: (type, summary, detail) => this.logAgentEvent(type, summary, detail),
      waitOrAbort: (promise) => waitOrAbort(promise, this.runtime.controller.signal),
      isAbortError: (error) => isAbortError(this.runtime.controller.signal, error),
      modifiedFiles: this.runtime.modifiedFiles,
    });
  }

  private async runLoop(task: AgentTaskInput, prior: Message[], debugLogUrl?: string): Promise<AgentOutcome> {
    const host = buildHostBindingSource(this.config, this.runtime, createSubAgent, this.hostCallbacks());
    return runAgentMainLoop({
      maxTurns: this.config.maxTurns,
      task,
      prior,
      debugLogUrl,
      signal: this.runtime.controller.signal,
      turns: this.runtime.turns,
      prepareInput: buildRunLoopPrepareInput({
        ...host,
        providerName: this.config.provider.name,
        tools: this.config.tools,
        history: this.runtime.history,
        pendingCheckpointId: this.runtime.pendingCheckpointId,
        globalTurn: this.runtime.globalTurn,
        toolCallFingerprints: this.runtime.toolCallFingerprints,
        setupHooks: () => this.setupHooks(),
        setupSkills: () => this.setupSkills(),
      }),
      turnHost: () => buildAgentTurnHost(host),
      newToolPipeline: () => this.newRunToolPipeline(),
      onPrepared: (prepared) => {
        this.runtime.history = prepared.turnState.history;
        this.runtime.pinnedTask = prepared.pinnedTask;
        this.runtime.requests.push(...prepared.requests);
        this.runtime.pendingCheckpointId = undefined;
      },
      onGlobalTurn: (turn) => {
        this.runtime.globalTurn = turn;
      },
      persist: () => this.persist(),
      setState: (next) => this.setState(next),
      outcome: (answer, completed) => this.outcome(answer, completed),
    });
  }

  private async persist(flush = false): Promise<void> {
    if (!this.config.persistSessions) return;
    const snapshot = {
      persistSessions: this.config.persistSessions,
      permissions: this.config.permissions,
      agentDir: this.config.agentDir,
      sessionId: this.config.sessionId,
      workspaceRoot: this.config.workspaceRoot,
      mode: this.config.mode,
      model: this.config.model,
      providerName: this.config.provider.name,
      createdAt: this.config.createdAt,
      planId: this.runtime.planId,
      history: structuredClone(this.runtime.history),
      turns: structuredClone(this.runtime.turns),
      pinnedTask: this.runtime.pinnedTask,
      requests: structuredClone(this.runtime.requests),
    };
    this.sessionPersistence.schedule(async () => {
      const existing = await loadSession(this.config.agentDir, this.config.sessionId).catch(() => null);
      if (existing?.config.planId) {
        snapshot.planId = existing.config.planId;
        this.runtime.planId = existing.config.planId;
      }
      await writeAgentSession(snapshot);
    });
    if (flush || !this.config.performance.asyncSessionPersistence) {
      await this.flushPersistence();
    }
  }

  private async flushPersistence(): Promise<void> {
    if (!this.config.persistSessions) return;
    try {
      await this.sessionPersistence.flush();
    } catch (error) {
      this.logAgentEvent("error", "Session persistence failed.", String(error));
      await this.emit("error", {
        message: `Session persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => undefined);
    }
  }

  private async emit(type: Parameters<AgentEventHandler>[0]["type"], payload: unknown) {
    await this.config.onEvent?.({ type, payload });
  }

  private outcome(answer: string, completed: boolean): AgentOutcome {
    const estimatedCostUsd = this.config.budget.snapshot().estimatedCostUsd;
    const stopReason = classifyAgentStopReason({
      completed,
      aborted: this.runtime.controller.signal.aborted,
      abortReason: this.runtime.controller.signal.reason,
      answer,
    });
    return {
      answer,
      turns: this.runtime.turns,
      completed,
      stopReason,
      sessionId: this.config.sessionId,
      trajectory: this.trajectoryRecorder?.finalize({
        completed,
        evaluated: false,
        estimatedCostUsd,
      }),
    };
  }
}
