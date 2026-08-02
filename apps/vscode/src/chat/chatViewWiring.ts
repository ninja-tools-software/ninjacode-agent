import * as vscode from "vscode";
import { AgentLogChannel } from "@ninjacode/core";
import type { CodebaseIndex } from "@ninjacode/tools";
import type { SettingsToHost, WebviewToHost } from "../protocol.js";
import { SettingsService } from "../settingsService.js";
import { ProposedEditsStore } from "../proposedEdits.js";
import { PlanEditorProvider } from "../planEditorProvider.js";
import { ChatCore } from "./chatCore.js";
import { AgentEventBridge } from "./agentEventBridge.js";
import { AgentRunner } from "./agentRunner.js";
import { CodebaseIndexService } from "./codebaseIndexService.js";
import { ContextController } from "./contextController.js";
import { EditsController } from "./editsController.js";
import { InteractionController } from "./interactionController.js";
import { McpService } from "./mcpService.js";
import { createMessageRouter } from "./messageRouter.js";
import { PlanService } from "./planService.js";
import { MessageFlowController } from "./messageFlowController.js";
import { SessionsController } from "./sessionsController.js";
import { WorkspaceExtrasController } from "./workspaceExtrasController.js";
import { VoiceController } from "./voiceController.js";
import { createChatHandlers } from "./chatViewHandlers.js";
import { DRAG_TIP_KEY } from "./chatConstants.js";

interface ChatViewWiring {
  settingsService: SettingsService;
  indexes: CodebaseIndexService;
  planEditor: PlanEditorProvider;
  plan: PlanService;
  sessions: SessionsController;
  edits: EditsController;
  interactions: InteractionController;
  contextCtl: ContextController;
  bridge: AgentEventBridge;
  runner: AgentRunner;
  voice: VoiceController;
  messageFlow: MessageFlowController;
  workspaceExtras: WorkspaceExtrasController;
  mcp: McpService;
  route: (msg: WebviewToHost) => Promise<void>;
  compactionOccurred: Set<string>;
  agentLogs: AgentLogChannel;
}

interface WireChatViewInput {
  context: vscode.ExtensionContext;
  core: ChatCore;
  proposedEdits: ProposedEditsStore;
  recentFiles: () => string[];
  codebaseIndex: (root: string) => Promise<CodebaseIndex | undefined>;
  friendlyRunError: (message: string) => string;
  pushSettings: () => Promise<void>;
  stopActiveSession: () => void;
  withActiveSession: (fn: (sessionId: string) => void) => void;
  resolveApproval: (requestId: string, approved: boolean, remember: boolean) => void;
  pushExtras: () => Promise<void>;
}

/** Construct and wire every chat controller. ChatViewProvider stays composition-only. */
export function wireChatView(input: WireChatViewInput): ChatViewWiring {
  const { context, core, proposedEdits } = input;
  const compactionOccurred = new Set<string>();
  const agentLogs = new AgentLogChannel((entry) => {
    core.post(entry.sessionId, { type: "agent_log_entry", entry });
  });
  const indexes = new CodebaseIndexService(context.subscriptions);
  const mcp = new McpService();

  const runnerHolder: { runner?: AgentRunner } = {};
  const workspaceExtrasHolder: { service?: WorkspaceExtrasController } = {};

  const settingsService = new SettingsService(context, {
    focusChat: () => core.focusChat(),
    loadExtras: () => workspaceExtrasHolder.service!.load(),
    agentLogs: () => agentLogs.list(),
    reloadMcp: () => workspaceExtrasHolder.service!.reloadMcp(),
  });

  const { planEditor, plan, sessions, edits } = createPlanLayer(input, {
    context,
    core,
    proposedEdits,
    settingsService,
    mcp,
    runMessage: (sid, text, mode) => runnerHolder.runner!.run({ sessionId: sid, text, modeOverride: mode }),
  });

  const agentLayer = createAgentLayer(input, {
    context,
    core,
    proposedEdits,
    plan,
    sessions,
    edits,
    compactionOccurred,
    agentLogs,
    mcp,
    settingsService,
  });
  runnerHolder.runner = agentLayer.runner;
  workspaceExtrasHolder.service = agentLayer.workspaceExtras;

  return { settingsService, indexes, planEditor, plan, sessions, edits, mcp, compactionOccurred, agentLogs, ...agentLayer };
}

function createPlanLayer(
  input: WireChatViewInput,
  deps: {
    context: vscode.ExtensionContext;
    core: ChatCore;
    proposedEdits: ProposedEditsStore;
    settingsService: SettingsService;
    mcp: McpService;
    runMessage: (sid: string | undefined, text: string, mode?: import("@ninjacode/core").AgentMode) => Promise<void>;
  },
) {
  const planHolder: { service?: PlanService } = {};
  const planEditor = new PlanEditorProvider(deps.context, {
    activeSessionId: () => deps.core.activeSessionId,
    isBusy: () => {
      const sid = deps.core.activeSessionId;
      return sid ? deps.core.runtimes.isBusy(sid) : false;
    },
    settingsPayload: () => deps.settingsService.buildPayload(),
    executePlan: (sid, model, planId) => planHolder.service!.execute(sid, model, planId),
    setModel: async (model) => {
      await deps.settingsService.handleMessage({ type: "set_model", model });
    },
    openMarkdownPreview: async (file) => {
      await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.file(file));
    },
  });

  const plan = new PlanService({
    agentDir: () => deps.core.agentDir(),
    workspaceRoot: () => deps.core.workspaceRoot(),
    activeSessionId: () => deps.core.activeSessionId,
    post: (sid, payload) => deps.core.post(sid, payload),
    pushSettings: () => input.pushSettings(),
    runMessage: deps.runMessage,
    settingsPayload: () => deps.settingsService.buildPayload(),
    setModel: async (model) => {
      await deps.settingsService.handleMessage({ type: "set_model", model });
    },
    isBusy: () => {
      const sid = deps.core.activeSessionId;
      return sid ? deps.core.runtimes.isBusy(sid) : false;
    },
    refreshPlanEditors: (planId) => planEditor.refreshForPlan(planId),
  });
  planHolder.service = plan;

  const sessions = new SessionsController({
    core: deps.core,
    proposedEdits: deps.proposedEdits,
    mcp: deps.mcp,
    syncPlanPanel: (sid) => plan.syncPanelForSession(sid),
    clearPlan: () => plan.clear(),
    clearTodos: () => plan.clearTodos(),
    closeMcp: () => deps.mcp.close(),
    pushSettings: () => input.pushSettings(),
    runMessage: (sid, text) => deps.runMessage(sid, text),
    showDragTip: () => !deps.context.globalState.get<boolean>(DRAG_TIP_KEY, false),
  });

  return { planEditor, plan, sessions, edits: new EditsController({ core: deps.core, store: deps.proposedEdits }) };
}

function createAgentLayer(
  input: WireChatViewInput,
  deps: {
    context: vscode.ExtensionContext;
    core: ChatCore;
    proposedEdits: ProposedEditsStore;
    plan: PlanService;
    sessions: SessionsController;
    edits: EditsController;
    compactionOccurred: Set<string>;
    agentLogs: AgentLogChannel;
    mcp: McpService;
    settingsService: SettingsService;
  },
) {
  const interactions = new InteractionController({
    core: deps.core,
    context: deps.context,
    reveal: async (sid) => {
      await deps.core.focusChat();
      await deps.sessions.switchSession(sid);
    },
  });

  const contextCtl = new ContextController({
    core: deps.core,
    codebaseIndex: (root) => input.codebaseIndex(root),
    recentFiles: input.recentFiles,
  });

  const bridge = createAgentEventBridge(input, deps);

  const runner = createAgentRunner(input, deps, { interactions, contextCtl, bridge });
  const voice = new VoiceController(deps.context.globalStorageUri.fsPath, (payload) =>
    deps.core.post(undefined, payload),
  );
  const messageFlow = new MessageFlowController({
    core: deps.core,
    contextCtl,
    runner,
    sessions: deps.sessions,
    compactionOccurred: deps.compactionOccurred,
  });
  const workspaceExtras = new WorkspaceExtrasController({
    workspaceRoot: () => deps.core.workspaceRoot(),
    mcp: deps.mcp,
  });

  const route = createChatMessageRoute(input, deps, { contextCtl, messageFlow, voice });

  deps.core.runtimes.setRunHandler((sid, text, mode) =>
    runner.run({ sessionId: sid, text, modeOverride: mode }),
  );

  return { interactions, contextCtl, bridge, runner, voice, messageFlow, workspaceExtras, route };
}

function createAgentRunner(
  input: WireChatViewInput,
  deps: {
    context: vscode.ExtensionContext;
    core: ChatCore;
    mcp: McpService;
    plan: PlanService;
    sessions: SessionsController;
  },
  stack: {
    interactions: InteractionController;
    contextCtl: ContextController;
    bridge: AgentEventBridge;
  },
): AgentRunner {
  return new AgentRunner({
    context: deps.context,
    runtimes: deps.core.runtimes,
    mcp: deps.mcp,
    post: (sid, payload) => deps.core.post(sid, payload),
    contextEnv: (root) => stack.contextCtl.env(root)!,
    codebaseIndex: (root) => input.codebaseIndex(root),
    onAgentEvent: (sid, ev) => stack.bridge.handle(sid, ev),
    requestApproval: (sid, req) => stack.interactions.requestApproval(sid, req),
    requestQuestion: (sid, req) => stack.interactions.requestQuestion(sid, req),
    requestUserAction: (sid, req) => stack.interactions.requestUserAction(sid, req),
    getActiveSessionId: () => deps.core.activeSessionId,
    setActiveSessionId: (sid) => (deps.core.activeSessionId = sid),
    clearTodos: () => deps.plan.clearTodos(),
    refreshTodos: (sid) => deps.plan.refreshTodos(sid),
    pushSessions: () => deps.sessions.pushSessions(),
    friendlyError: (m) => input.friendlyRunError(m),
    notifyIfNotFocused: (sid, ok, answer) => stack.interactions.notifyRunFinished(sid, ok, answer),
  });
}

function createAgentEventBridge(
  input: WireChatViewInput,
  deps: {
    core: ChatCore;
    proposedEdits: ProposedEditsStore;
    agentLogs: AgentLogChannel;
    compactionOccurred: Set<string>;
    plan: PlanService;
  },
): AgentEventBridge {
  return new AgentEventBridge({
    post: (sid, payload) => deps.core.post(sid, payload),
    runtimes: deps.core.runtimes,
    proposedEdits: deps.proposedEdits,
    logAgentEntry: (sid, e) =>
      deps.agentLogs.log({
        sessionId: sid,
        type: e.type,
        summary: e.summary,
        detail: e.detail,
        meta: e.meta,
      }),
    friendlyError: (m) => input.friendlyRunError(m),
    refreshTodos: (sid) => void deps.plan.refreshTodos(sid),
    refreshScratchpad: (sid) => void deps.plan.refresh(sid),
    syncTodosIntoPlan: (sid) => void deps.plan.syncTodosIntoPlan(sid),
    openPlanEditor: () => void deps.plan.openEditor(deps.core.activeSessionId),
    pushPlansList: (sid) => void deps.plan.pushPlansList(sid),
    syncPlanEditor: () => void deps.plan.syncEditorPanel(),
    markCompacted: (sid) => deps.compactionOccurred.add(sid),
  });
}

function createChatMessageRoute(
  input: WireChatViewInput,
  deps: {
    context: vscode.ExtensionContext;
    core: ChatCore;
    sessions: SessionsController;
    edits: EditsController;
    plan: PlanService;
    settingsService: SettingsService;
  },
  stack: {
    contextCtl: ContextController;
    messageFlow: MessageFlowController;
    voice: VoiceController;
  },
): (msg: WebviewToHost) => Promise<void> {
  return createMessageRouter(
    createChatHandlers({
      core: deps.core,
      sessions: deps.sessions,
      edits: deps.edits,
      contextCtl: stack.contextCtl,
      messageFlow: stack.messageFlow,
      plan: deps.plan,
      voice: stack.voice,
      context: deps.context,
      globalState: deps.context.globalState,
      stopActiveSession: input.stopActiveSession,
      resolveApproval: input.resolveApproval,
      withActiveSession: input.withActiveSession,
      pushSettings: input.pushSettings,
      pushExtras: input.pushExtras,
    }),
    (msg: SettingsToHost) => deps.settingsService.handleMessage(msg),
  );
}
