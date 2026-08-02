import { randomUUID } from "node:crypto";
import type { Agent, AgentMode, Checkpoint, RunState } from "@ninjacode/core";
import type {
  ContextUsage,
  Hypothesis,
  QueuedMessage,
  SessionUsagePayload,
  TodoUiItem,
  UiLogItem,
  UiQuestion,
  UiQuestionAnswer,
} from "./protocol.js";

export type {
  
  
  QueuedMessage,
  
  
  
  
  
  
  
};

export interface RuntimeUiState {
  log: UiLogItem[];
  todos: TodoUiItem[];
  pendingEdits: string[];
  hypotheses: Hypothesis[];
  debugLogCount: number;
  contextUsage: ContextUsage | null;
  sessionUsage: SessionUsagePayload | null;
}

interface PendingApprovalEntry {
  toolName: string;
  target: string;
  resolve: (v: { approved: boolean; remember?: boolean }) => void;
}

interface PendingQuestionEntry {
  questions: UiQuestion[];
  resolve: (answers: UiQuestionAnswer[]) => void;
}

interface PendingUserActionEntry {
  action: string;
  resolve: (v: { comment?: string }) => void;
}

/**
 * Everything the extension tracks for a single local session (one persisted
 * conversation) so multiple sessions can run concurrently while the user
 * navigates between them.
 */
export interface SessionRuntime {
  sessionId: string;
  agent?: Agent;
  runState: RunState;
  queue: QueuedMessage[];
  pendingApprovals: Map<string, PendingApprovalEntry>;
  pendingQuestions: Map<string, PendingQuestionEntry>;
  pendingUserActions: Map<string, PendingUserActionEntry>;
  ui: RuntimeUiState;
  checkpoints: Checkpoint[];
}

type RunHandler = (
  sessionId: string,
  text: string,
  mode?: AgentMode,
) => Promise<void> | void;

function emptyUi(): RuntimeUiState {
  return {
    log: [],
    todos: [],
    pendingEdits: [],
    hypotheses: [],
    debugLogCount: 0,
    contextUsage: null,
    sessionUsage: null,
  };
}

/**
 * Owns per-session run state (agent handle, RunState, queued messages,
 * pending approvals, and a mirrored UI log) so the webview can be hydrated
 * whether or not the session's agent is currently visible/active.
 */
export class SessionRuntimeManager {
  private readonly runtimes = new Map<string, SessionRuntime>();
  private runHandler?: RunHandler;

  /** Called back with (sessionId, text, mode) whenever a queued message should run. */
  setRunHandler(handler: RunHandler): void {
    this.runHandler = handler;
  }

  has(sessionId: string): boolean {
    return this.runtimes.has(sessionId);
  }

  get(sessionId: string): SessionRuntime | undefined {
    return this.runtimes.get(sessionId);
  }

  getOrCreate(sessionId: string): SessionRuntime {
    let rt = this.runtimes.get(sessionId);
    if (!rt) {
      rt = {
        sessionId,
        runState: "idle",
        queue: [],
        pendingApprovals: new Map(),
        pendingQuestions: new Map(),
        pendingUserActions: new Map(),
        ui: emptyUi(),
        checkpoints: [],
      };
      this.runtimes.set(sessionId, rt);
    }
    return rt;
  }

  /** Seed (or replace) a runtime's mirrored UI state, e.g. from persisted history. */
  seedUi(sessionId: string, ui: Partial<RuntimeUiState>): SessionRuntime {
    const rt = this.getOrCreate(sessionId);
    rt.ui = { ...rt.ui, ...ui };
    return rt;
  }

  setAgent(sessionId: string, agent: Agent | undefined): void {
    this.getOrCreate(sessionId).agent = agent;
  }

  setRunState(sessionId: string, state: RunState): void {
    this.getOrCreate(sessionId).runState = state;
  }

  isBusy(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    const rt = this.runtimes.get(sessionId);
    if (!rt) return false;
    return rt.runState === "running" || rt.runState === "waiting" || rt.runState === "stopping";
  }

  /** Abort the running agent for a session, if any. Returns whether a stop was issued. */
  stop(sessionId: string): boolean {
    const rt = this.runtimes.get(sessionId);
    if (!rt?.agent) return false;
    rt.agent.abort();
    this.cancelAllPending(sessionId);
    return true;
  }

  registerApproval(opts: {
    sessionId: string;
    requestId: string;
    toolName: string;
    target: string;
    resolve: (v: { approved: boolean; remember?: boolean }) => void;
  }): void {
    const { sessionId, requestId, toolName, target, resolve } = opts;
    this.getOrCreate(sessionId).pendingApprovals.set(requestId, { toolName, target, resolve });
  }

  resolveApproval(
    sessionId: string,
    requestId: string,
    value: { approved: boolean; remember?: boolean },
  ): boolean {
    const rt = this.runtimes.get(sessionId);
    const pending = rt?.pendingApprovals.get(requestId);
    if (!rt || !pending) return false;
    rt.pendingApprovals.delete(requestId);
    pending.resolve(value);
    return true;
  }

  /** Deny + clear all pending approvals for a session (e.g. after stop). Returns cancelled ids. */
  cancelPendingApprovals(sessionId: string): string[] {
    const rt = this.runtimes.get(sessionId);
    if (!rt || rt.pendingApprovals.size === 0) return [];
    const ids = [...rt.pendingApprovals.keys()];
    for (const [, entry] of rt.pendingApprovals) {
      entry.resolve({ approved: false });
    }
    rt.pendingApprovals.clear();
    return ids;
  }

  registerQuestion(
    sessionId: string,
    requestId: string,
    questions: UiQuestion[],
    resolve: (answers: UiQuestionAnswer[]) => void,
  ): void {
    this.getOrCreate(sessionId).pendingQuestions.set(requestId, { questions, resolve });
  }

  resolveQuestion(sessionId: string, requestId: string, answers: UiQuestionAnswer[]): boolean {
    const rt = this.runtimes.get(sessionId);
    const pending = rt?.pendingQuestions.get(requestId);
    if (!rt || !pending) return false;
    rt.pendingQuestions.delete(requestId);
    pending.resolve(answers);
    return true;
  }

  /** Resolve all pending questions with empty answers (e.g. after stop). Returns cancelled ids. */
  cancelPendingQuestions(sessionId: string): string[] {
    const rt = this.runtimes.get(sessionId);
    if (!rt || rt.pendingQuestions.size === 0) return [];
    const ids = [...rt.pendingQuestions.keys()];
    for (const [, entry] of rt.pendingQuestions) {
      entry.resolve([]);
    }
    rt.pendingQuestions.clear();
    return ids;
  }

  registerUserAction(
    sessionId: string,
    requestId: string,
    action: string,
    resolve: (v: { comment?: string }) => void,
  ): void {
    this.getOrCreate(sessionId).pendingUserActions.set(requestId, { action, resolve });
  }

  resolveUserAction(sessionId: string, requestId: string, comment?: string): boolean {
    const rt = this.runtimes.get(sessionId);
    const pending = rt?.pendingUserActions.get(requestId);
    if (!rt || !pending) return false;
    rt.pendingUserActions.delete(requestId);
    pending.resolve({ comment });
    return true;
  }

  /** Release all pending manual-action pauses (e.g. after stop). Returns cancelled ids. */
  cancelPendingUserActions(sessionId: string): string[] {
    const rt = this.runtimes.get(sessionId);
    if (!rt || rt.pendingUserActions.size === 0) return [];
    const ids = [...rt.pendingUserActions.keys()];
    for (const [, entry] of rt.pendingUserActions) {
      entry.resolve({});
    }
    rt.pendingUserActions.clear();
    return ids;
  }

  /** Cancel every pending interactive request (approvals, questions, manual actions). */
  cancelAllPending(sessionId: string): {
    approvals: string[];
    questions: string[];
    userActions: string[];
  } {
    return {
      approvals: this.cancelPendingApprovals(sessionId),
      questions: this.cancelPendingQuestions(sessionId),
      userActions: this.cancelPendingUserActions(sessionId),
    };
  }

  enqueue(sessionId: string, text: string, mode?: AgentMode): QueuedMessage {
    const rt = this.getOrCreate(sessionId);
    const msg: QueuedMessage = { id: randomUUID(), text, mode, queuedAt: Date.now() };
    rt.queue.push(msg);
    return msg;
  }

  /** Interrupt the current run and jump this message to the front of the queue. */
  steer(sessionId: string, text: string, mode?: AgentMode): QueuedMessage {
    const rt = this.getOrCreate(sessionId);
    const msg: QueuedMessage = { id: randomUUID(), text, mode, queuedAt: Date.now() };
    rt.queue.unshift(msg);
    rt.agent?.abort();
    this.cancelAllPending(sessionId);
    return msg;
  }

  /** Stop the current run immediately, discard the queue, and send this message next. */
  stopAndSend(sessionId: string, text: string, mode?: AgentMode): QueuedMessage {
    const rt = this.getOrCreate(sessionId);
    const msg: QueuedMessage = { id: randomUUID(), text, mode, queuedAt: Date.now() };
    rt.queue = [msg];
    rt.agent?.abort();
    this.cancelAllPending(sessionId);
    return msg;
  }

  reorderQueue(sessionId: string, id: string, direction: "up" | "down"): void {
    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    const idx = rt.queue.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= rt.queue.length) return;
    const queue = [...rt.queue];
    [queue[idx], queue[swapWith]] = [queue[swapWith]!, queue[idx]!];
    rt.queue = queue;
  }

  removeFromQueue(sessionId: string, id: string): void {
    const rt = this.runtimes.get(sessionId);
    if (!rt) return;
    rt.queue = rt.queue.filter((m) => m.id !== id);
  }

  private dequeueNext(sessionId: string): QueuedMessage | undefined {
    return this.runtimes.get(sessionId)?.queue.shift();
  }

  /** If the session is idle and has queued messages, kick off the next one. */
  async processQueueIfIdle(sessionId: string): Promise<void> {
    if (this.isBusy(sessionId)) return;
    const next = this.dequeueNext(sessionId);
    if (!next) return;
    await this.runHandler?.(sessionId, next.text, next.mode);
  }

  /** Fully drop a session's runtime state (does not touch persisted history on disk). */
  clear(sessionId: string): void {
    const rt = this.runtimes.get(sessionId);
    if (rt) {
      this.cancelAllPending(sessionId);
      rt.agent?.abort();
    }
    this.runtimes.delete(sessionId);
  }

  disposeAll(): void {
    for (const id of [...this.runtimes.keys()]) this.clear(id);
  }
}
