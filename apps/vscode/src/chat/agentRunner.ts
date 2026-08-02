import * as vscode from "vscode";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  Agent,
  buildAgentRuntime,
  createCustomAgentHandoffTools,
  enabledCustomAgents,
  loadCustomAgents,
  type AgentMode,
  type AgentOptions,
} from "@ninjacode/core";
import { createProvider } from "@ninjacode/providers";
import { createDefaultToolRegistry, setAskUserHandler, setUserActionHandler } from "@ninjacode/tools";
import type { AskUserAnswer, AskUserRequest, UserActionRequest } from "@ninjacode/tools";
import type { ComposerNode, ContextRef, HostToWebview } from "../protocol.js";
import type { SessionRuntimeManager } from "../sessionRuntime.js";
import type { AgentEvent } from "./agentEventBridge.js";
import type { ContextEnv } from "./context/index.js";
import { buildTask, withoutImages } from "./contextRefs.js";
import { activeSelectionSection, createDiagnosticsProvider, workspaceErrorsSection } from "./editorContext.js";
import { ensureApiKey, grantsFrom, readRunConfig } from "./runConfig.js";
import type { McpService } from "./mcpService.js";
import { isWorkspaceTrusted, warnIfUntrustedWorkspace } from "../workspaceTrust.js";

export interface RunRequest {
  sessionId?: string;
  text: string;
  nodes?: ComposerNode[];
  refs?: ContextRef[];
  modeOverride?: AgentMode;
}

interface AgentRunnerDeps {
  context: vscode.ExtensionContext;
  runtimes: SessionRuntimeManager;
  mcp: McpService;
  post(sessionId: string | undefined, payload: HostToWebview): void;
  contextEnv(root: string): ContextEnv;
  codebaseIndex(root: string): Promise<unknown>;
  onAgentEvent(sessionId: string, ev: AgentEvent): void;
  requestApproval(
    sessionId: string,
    req: { toolName: string; target: string; reason: string; grantScopes?: string[] },
  ): Promise<{ approved: boolean; remember?: boolean }>;
  requestQuestion(sessionId: string, request: AskUserRequest): Promise<AskUserAnswer[]>;
  requestUserAction(sessionId: string, request: UserActionRequest): Promise<{ comment?: string }>;
  getActiveSessionId(): string | undefined;
  setActiveSessionId(sessionId: string): void;
  clearTodos(): Promise<void>;
  refreshTodos(sessionId: string): Promise<void>;
  pushSessions(): Promise<void>;
  friendlyError(message: string): string;
  notifyIfNotFocused(sessionId: string, completed: boolean, answer: string): void;
}

interface PreparedRun {
  root: string;
  bindToActive: boolean;
  sid: string;
  task: Awaited<ReturnType<typeof buildTask>>;
  agent: Agent;
}

/**
 * Runs one user message against a (possibly new) session's agent. Concurrent sessions
 * are supported: several calls with different session ids can be in flight at once,
 * each owning its own Agent/AbortController through the runtime manager.
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async run(request: RunRequest): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.deps.post(request.sessionId, { type: "error", text: "Open a workspace folder first." });
      return;
    }

    const prepared = await this.prepareRun(request, folder.uri.fsPath);
    if (!prepared) return;

    const { sid, task, agent, bindToActive } = prepared;
    this.deps.runtimes.setAgent(sid, agent);
    if (bindToActive) {
      this.deps.setActiveSessionId(sid);
      this.deps.post(undefined, { type: "session_changed", activeSessionId: sid });
    }
    if (!request.sessionId) await this.deps.clearTodos();

    this.deps.post(sid, { type: "user", text: task.body || request.text, refs: task.refs });
    await this.execute(agent, sid, task);
  }

  private async prepareRun(request: RunRequest, root: string): Promise<PreparedRun | undefined> {
    const bindToActive = request.sessionId
      ? this.deps.getActiveSessionId() === request.sessionId
      : this.deps.getActiveSessionId() === undefined;

    const config = readRunConfig(request.modeOverride);
    const apiKey = await ensureApiKey(this.deps.context, config.kind);
    if (apiKey === undefined) return undefined;

    const provider = createProvider({
      kind: config.kind,
      apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    let sid = request.sessionId ?? randomUUID();
    const saved = this.deps.context.workspaceState.get<string[]>("ninjacode.grants") ?? [];
    setAskUserHandler(async (req) => this.deps.requestQuestion(sid, req));
    setUserActionHandler(async (req) => this.deps.requestUserAction(sid, req));

    const env = this.deps.contextEnv(root);
    const built = await buildTask(request, env, [activeSelectionSection(), workspaceErrorsSection(root)]);
    const task = config.vision ? built : withoutImages(built);
    if (task !== built) {
      this.deps.post(request.sessionId, {
        type: "error",
        text: `${config.model ?? "This model"} cannot read images — the attached image was left out.`,
      });
    }

    const agentDir = path.join(root, ".ninjacode");
    const trusted = isWorkspaceTrusted();
    if (!trusted) warnIfUntrustedWorkspace();
    const codebaseIndex = await this.deps.codebaseIndex(root).catch(() => undefined);
    const runtime = await buildAgentRuntime({
      workspaceRoot: root,
      provider,
      approvalMode: config.approvalMode,
      grants: grantsFrom(saved),
      configureTools: async (tools) => {
        if (!trusted) return;
        for (const t of await this.deps.mcp.tools(root)) tools.register(t);
      },
      agent: {
        agentDir,
        mode: config.mode,
        model: config.model,
        utilityModel: config.kind === "gateway" ? "deepseek-v4-flash" : undefined,
        maxTokens: config.maxTokens,
        reasoningEffort: config.reasoningEffort,
        thinkingBudgetTokens: config.thinkingBudgetTokens,
        contextWindow: config.contextWindow,
        codebaseIndex: codebaseIndex as never,
        diagnosticsProvider: createDiagnosticsProvider(root),
        enableWorkspaceHooks: trusted,
      },
    });

    await this.registerHandoffTools(runtime.tools, { provider, root, agentDir, sessionId: () => sid });
    const created = await this.createAgent(runtime.agentOptions, request.sessionId, sid);
    sid = created.sessionId;

    return { root, bindToActive, sid, task, agent: created.agent };
  }

  private async createAgent(
    agentOptions: AgentOptions,
    requestedSessionId: string | undefined,
    sid: string,
  ): Promise<{ agent: Agent; sessionId: string }> {
    const buildOpts = (id: string) => ({
      ...agentOptions,
      sessionId: id,
      onEvent: (ev: AgentEvent) => this.deps.onAgentEvent(id, ev),
      onApproval: (req: {
        toolName: string;
        target: string;
        reason: string;
        grantScopes?: string[];
      }) => this.deps.requestApproval(id, req),
    });

    try {
      if (requestedSessionId) {
        const resumed = await Agent.resume({ ...buildOpts(sid), sessionId: sid });
        return { agent: resumed.agent, sessionId: sid };
      }
      return { agent: new Agent(buildOpts(sid)), sessionId: sid };
    } catch {
      const freshId = randomUUID();
      return { agent: new Agent(buildOpts(freshId)), sessionId: freshId };
    }
  }

  private async execute(
    agent: Agent,
    sid: string,
    task: { text: string; images: Awaited<ReturnType<typeof buildTask>>["images"] },
  ): Promise<void> {
    try {
      const outcome = await agent.run(
        task.images.length > 0 ? { text: task.text, images: task.images } : task.text,
      );
      if (!outcome.completed) {
        this.deps.post(sid, { type: "error", text: this.deps.friendlyError(outcome.answer) });
      }
      this.deps.post(sid, { type: "assistant_done" });
      await this.deps.refreshTodos(sid);
      await this.deps.pushSessions();
      this.deps.notifyIfNotFocused(sid, outcome.completed, outcome.answer);
    } catch (e) {
      this.deps.post(sid, { type: "error", text: this.deps.friendlyError((e as Error).message) });
    } finally {
      await this.deps.runtimes.processQueueIfIdle(sid);
    }
  }

  private async registerHandoffTools(
    tools: ReturnType<typeof createDefaultToolRegistry>,
    opts: {
      provider: ReturnType<typeof createProvider>;
      root: string;
      agentDir: string;
      sessionId: () => string;
    },
  ): Promise<void> {
    const customAgents = enabledCustomAgents(await loadCustomAgents(opts.root).catch(() => []));
    if (customAgents.length === 0) return;
    for (const t of createCustomAgentHandoffTools(customAgents, {
      createAgent: (handoffOpts) => new Agent({ ...handoffOpts, persistSessions: false, enableSubagents: false }),
      provider: opts.provider,
      workspaceRoot: opts.root,
      agentDir: opts.agentDir,
      onEvent: (ev) => this.deps.onAgentEvent(opts.sessionId(), ev),
    })) {
      tools.register(t);
    }
  }
}
