import * as vscode from "vscode";
import type { ChatMessageHandlers } from "./messageRouter.js";
import type { ChatCore } from "./chatCore.js";
import type { ContextController } from "./contextController.js";
import type { EditsController } from "./editsController.js";
import type { MessageFlowController } from "./messageFlowController.js";
import type { PlanService } from "./planService.js";
import type { SessionsController } from "./sessionsController.js";
import type { VoiceController } from "./voiceController.js";
import { DRAG_TIP_KEY } from "./chatConstants.js";
import { MermaidPanel } from "../mermaidPanel.js";
import { handleEnhancePrompt } from "./enhancePrompt.js";

export function createRunHandlers(deps: {
  core: ChatCore;
  sessions: SessionsController;
  messageFlow: MessageFlowController;
  stopActiveSession: () => void;
  resolveApproval: (requestId: string, approved: boolean, remember: boolean) => void;
  withActiveSession: (fn: (sessionId: string) => void) => void;
}): Pick<
  ChatMessageHandlers,
  | "user_message"
  | "new_session"
  | "compact_conversation"
  | "stop"
  | "reorder_queue"
  | "remove_queued"
  | "approve"
  | "approve_always"
  | "deny"
  | "question_answer"
  | "user_action_done"
> {
  const { core, sessions, messageFlow } = deps;
  return {
    user_message: (m) => messageFlow.onUserMessage(m),
    new_session: () => sessions.newSession(),
    compact_conversation: () => messageFlow.compactActiveSession(),
    stop: () => void deps.stopActiveSession(),
    reorder_queue: (m) => deps.withActiveSession((sid) => {
      core.runtimes.reorderQueue(sid, m.queueId, m.direction);
      sessions.pushQueue(sid);
    }),
    remove_queued: (m) => deps.withActiveSession((sid) => {
      core.runtimes.removeFromQueue(sid, m.queueId);
      sessions.pushQueue(sid);
    }),
    approve: (m) => deps.resolveApproval(m.requestId, true, false),
    approve_always: (m) => deps.resolveApproval(m.requestId, true, true),
    deny: (m) => deps.resolveApproval(m.requestId, false, false),
    question_answer: (m) =>
      deps.withActiveSession((sid) => core.runtimes.resolveQuestion(sid, m.requestId, m.answers)),
    user_action_done: (m) =>
      deps.withActiveSession((sid) => core.runtimes.resolveUserAction(sid, m.requestId, m.comment)),
  };
}

export function createEditHandlers(deps: {
  edits: EditsController;
  messageFlow: MessageFlowController;
}): Pick<
  ChatMessageHandlers,
  | "review_edit"
  | "accept_all"
  | "reject_all"
  | "cancel_auto_accept"
  | "accept_edit"
  | "reject_edit"
  | "get_hunks"
  | "accept_hunk"
  | "reject_hunk"
  | "send_feedback"
> {
  const { edits, messageFlow } = deps;
  return {
    review_edit: (m) => edits.review(m.path),
    accept_all: () => edits.acceptAll(),
    reject_all: () => edits.rejectAll(),
    cancel_auto_accept: () => edits.cancelAutoAccept(),
    accept_edit: (m) => edits.accept(m.path),
    reject_edit: (m) => edits.reject(m.path),
    get_hunks: (m) => edits.postHunks(m.path),
    accept_hunk: (m) => edits.acceptHunk(m.path, m.hunkId),
    reject_hunk: (m) => edits.rejectHunk(m.path, m.hunkId),
    send_feedback: (m) =>
      m.text.trim()
        ? messageFlow.onUserMessage({
            text: `Feedback on the proposed edit to \`${m.path}\`:\n${m.text.trim()}`,
          })
        : undefined,
  };
}

export function createSessionHandlers(deps: {
  sessions: SessionsController;
}): Pick<
  ChatMessageHandlers,
  | "list_sessions"
  | "switch_session"
  | "delete_session"
  | "fork_session"
  | "edit_and_resend"
  | "rename_session"
  | "pin_session"
  | "archive_session"
  | "export_session"
> {
  const { sessions } = deps;
  return {
    list_sessions: () => sessions.pushSessions(),
    switch_session: (m) => sessions.switchSession(m.sessionId),
    delete_session: (m) => sessions.deleteSession(m.sessionId),
    fork_session: (m) => sessions.fork(m.sessionId, m.messageIndex),
    edit_and_resend: (m) =>
      m.text.trim() ? sessions.editAndResend(m.sessionId, m.messageIndex, m.text.trim()) : undefined,
    rename_session: (m) => sessions.rename(m.sessionId, m.title),
    pin_session: (m) => sessions.setFlags(m.sessionId, { pinned: m.pinned ?? true }),
    archive_session: (m) => sessions.setFlags(m.sessionId, { archived: m.archived ?? true }),
    export_session: (m) => sessions.exportToFile(m.sessionId, m.format ?? "markdown"),
  };
}

export function createContextHandlers(deps: {
  contextCtl: ContextController;
  globalState: vscode.Memento;
}): Pick<
  ChatMessageHandlers,
  | "mention_query"
  | "context_query"
  | "resolve_context_item"
  | "get_current_selection"
  | "resolve_drop"
  | "resolve_refs"
  | "open_ref"
  | "ref_preview"
  | "pick_files_native"
  | "dismiss_drag_tip"
> {
  const { contextCtl } = deps;
  return {
    mention_query: (m) => contextCtl.suggestMentions(m.query),
    context_query: (m) => contextCtl.suggest(m.queryType, m.query),
    resolve_context_item: (m) =>
      contextCtl.resolveItem(m.queryType, m.contextId, m.contextLabel ?? m.contextId, m.requestId),
    get_current_selection: (m) => contextCtl.postCurrentSelection(m.requestId),
    resolve_drop: (m) => contextCtl.resolveDrop(m.requestId, m.items),
    resolve_refs: (m) => contextCtl.resolveExisting(m.requestId, m.refs),
    open_ref: (m) => contextCtl.open(m.ref),
    ref_preview: (m) => contextCtl.preview(m.requestId, m.ref),
    pick_files_native: (m) => contextCtl.pickFiles(m.requestId),
    dismiss_drag_tip: () => deps.globalState.update(DRAG_TIP_KEY, true),
  };
}

export function createPlanHandlers(deps: {
  core: ChatCore;
  plan: PlanService;
  voice: VoiceController;
}): Pick<
  ChatMessageHandlers,
  | "execute_plan"
  | "open_plan"
  | "list_plans"
  | "activate_plan"
  | "rename_plan"
  | "delete_plan"
  | "open_plan_markdown"
  | "voice_start"
  | "voice_stop"
  | "voice_cancel"
> {
  const { core, plan, voice } = deps;
  return {
    execute_plan: (m) => plan.execute(core.activeSessionId, m.model),
    open_plan: (m) => plan.openEditor(core.activeSessionId, m.planId),
    list_plans: () => void plan.pushPlansList(core.activeSessionId),
    activate_plan: (m) => void plan.activate(core.activeSessionId, m.planId),
    rename_plan: (m) => void plan.rename(core.activeSessionId, m.planId, m.title),
    delete_plan: (m) => void plan.remove(core.activeSessionId, m.planId),
    open_plan_markdown: () => void plan.openMarkdownPreview(core.activeSessionId),
    voice_start: () => voice.start(),
    voice_stop: () => voice.stop(),
    voice_cancel: () => voice.cancel(),
  };
}

export function createLifecycleHandlers(deps: {
  core: ChatCore;
  sessions: SessionsController;
  plan: PlanService;
  context: vscode.ExtensionContext;
  pushSettings: () => Promise<void>;
  pushExtras: () => Promise<void>;
}): Pick<
  ChatMessageHandlers,
  | "ready"
  | "get_settings"
  | "open_settings"
  | "chat_focus"
  | "copy_to_clipboard"
  | "open_mermaid"
  | "enhance_prompt"
> {
  const { core, sessions, plan } = deps;
  return {
    ready: async () => {
      sessions.hydrateActive();
      await deps.pushSettings();
      await sessions.pushSessions();
      void deps.pushExtras();
      await plan.syncPanelForSession(core.activeSessionId);
    },
    get_settings: async () => {
      await deps.pushSettings();
      void deps.pushExtras();
    },
    open_settings: () => vscode.commands.executeCommand("ninjacode.openSettings"),
    chat_focus: (m) =>
      vscode.commands.executeCommand("setContext", "ninjacode.chatFocused", m.focused),
    copy_to_clipboard: (m) => {
      if (m.text) void vscode.env.clipboard.writeText(m.text);
    },
    open_mermaid: (m) => MermaidPanel.show(deps.context, m.source),
    enhance_prompt: (m) =>
      handleEnhancePrompt(deps.context, m, (payload) => core.post(undefined, payload)),
  };
}
