import type { ContextRef, SendMode } from "../protocol.js";
import { buildTask } from "./contextRefs.js";
import type { AgentRunner, RunRequest } from "./agentRunner.js";
import type { ChatCore } from "./chatCore.js";
import type { ContextController } from "./contextController.js";
import type { SessionsController } from "./sessionsController.js";

interface MessageFlowDeps {
  core: ChatCore;
  contextCtl: ContextController;
  runner: AgentRunner;
  sessions: SessionsController;
  compactionOccurred: Set<string>;
}

/**
 * Routes user messages while a session is idle or busy (queue, steer, stop-and-send)
 * and handles manual conversation compaction.
 */
export class MessageFlowController {
  constructor(private readonly deps: MessageFlowDeps) {}

  async onUserMessage(msg: {
    text: string;
    nodes?: RunRequest["nodes"];
    refs?: ContextRef[];
    sendMode?: SendMode;
  }): Promise<void> {
    const sid = this.deps.core.activeSessionId;
    if (!sid || !this.deps.core.runtimes.isBusy(sid)) {
      await this.deps.runner.run({ sessionId: sid, text: msg.text, nodes: msg.nodes, refs: msg.refs });
      return;
    }
    await this.enqueueWhileBusy(sid, msg);
  }

  /** The queue only carries plain text, so attached context is folded into the body. */
  private async enqueueWhileBusy(
    sid: string,
    msg: { text: string; nodes?: RunRequest["nodes"]; refs?: ContextRef[]; sendMode?: SendMode },
  ): Promise<void> {
    const env = this.deps.contextCtl.env();
    let text = msg.text;
    if (env) {
      const task = await buildTask(msg, env);
      text = task.text;
      if (task.images.length > 0) {
        text += `\n\n[${task.images.length} image attachment(s) dropped — attach images to a message sent immediately, not a queued one]`;
      }
    }

    const { core, sessions } = this.deps;
    if (msg.sendMode === "steer") {
      core.runtimes.steer(sid, text);
      core.post(sid, { type: "status", text: "Steering — restarting with your new message…" });
    } else if (msg.sendMode === "stop_and_send") {
      core.runtimes.stopAndSend(sid, text);
      core.post(sid, { type: "status", text: "Stopping and sending your new message…" });
    } else {
      core.runtimes.enqueue(sid, text);
    }
    sessions.pushQueue(sid);
  }

  /** Manually compact the active session's history right now (`/compact`). */
  async compactActiveSession(): Promise<void> {
    const sid = this.deps.core.activeSessionId;
    if (!sid) return;
    if (this.deps.core.runtimes.isBusy(sid)) {
      this.deps.core.post(sid, { type: "status", text: "⋯ cannot compact while the agent is running" });
      return;
    }
    const agent = this.deps.core.runtimes.get(sid)?.agent;
    if (!agent) {
      this.deps.core.post(sid, { type: "status", text: "⋯ nothing to compact yet" });
      return;
    }
    try {
      this.deps.compactionOccurred.delete(sid);
      const usage = await agent.compact();
      if (usage === null || !this.deps.compactionOccurred.has(sid)) {
        this.deps.core.post(sid, { type: "status", text: "⋯ nothing to compact yet" });
      }
      this.deps.compactionOccurred.delete(sid);
    } catch (e) {
      this.deps.core.post(sid, { type: "error", text: (e as Error).message });
    }
  }
}
