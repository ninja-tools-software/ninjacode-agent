import type { ChatMessageHandlers } from "./messageRouter.js";
import type { ChatCore } from "./chatCore.js";
import type { ContextController } from "./contextController.js";
import type { EditsController } from "./editsController.js";
import type { MessageFlowController } from "./messageFlowController.js";
import type { PlanService } from "./planService.js";
import type { SessionsController } from "./sessionsController.js";
import type { VoiceController } from "./voiceController.js";
import type * as vscode from "vscode";
import {
  createContextHandlers,
  createEditHandlers,
  createLifecycleHandlers,
  createPlanHandlers,
  createRunHandlers,
  createSessionHandlers,
} from "./chatHandlerGroups.js";

interface ChatHandlersDeps {
  core: ChatCore;
  sessions: SessionsController;
  edits: EditsController;
  contextCtl: ContextController;
  messageFlow: MessageFlowController;
  plan: PlanService;
  voice: VoiceController;
  context: vscode.ExtensionContext;
  globalState: vscode.Memento;
  stopActiveSession: () => void;
  resolveApproval: (requestId: string, approved: boolean, remember: boolean) => void;
  withActiveSession: (fn: (sessionId: string) => void) => void;
  pushSettings: () => Promise<void>;
  pushExtras: () => Promise<void>;
}

/** One entry per chat message type — exhaustiveness is enforced by the type. */
export function createChatHandlers(deps: ChatHandlersDeps): ChatMessageHandlers {
  return {
    ...createLifecycleHandlers(deps),
    ...createRunHandlers(deps),
    ...createEditHandlers(deps),
    ...createSessionHandlers(deps),
    ...createContextHandlers(deps),
    ...createPlanHandlers(deps),
  };
}
