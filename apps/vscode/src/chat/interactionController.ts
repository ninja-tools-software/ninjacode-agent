import * as vscode from "vscode";
import type { AskUserAnswer, AskUserRequest, UserActionRequest } from "@ninjacode/tools";
import { t } from "../locale.js";
import type { ChatCore } from "./chatCore.js";

interface InteractionControllerDeps {
  core: ChatCore;
  context: vscode.ExtensionContext;
  /** Bring the chat to the front on this session (used by notification buttons). */
  reveal(sessionId: string): Promise<void>;
}

/**
 * Blocking, user-facing prompts raised mid-run: tool approvals, question cards and
 * manual-action pauses — plus the OS notifications that surface them when the chat
 * panel isn't the thing the user is looking at.
 */
export class InteractionController {
  constructor(private readonly deps: InteractionControllerDeps) {}

  private get core(): ChatCore {
    return this.deps.core;
  }

  async requestApproval(
    sessionId: string,
    req: {
      toolName: string;
      target: string;
      reason: string;
      grantScopes?: string[];
      canRemember?: boolean;
      danger?: boolean;
    },
  ): Promise<{ approved: boolean; remember?: boolean }> {
    const requestId = `${Date.now()}_${req.toolName}`;
    const scopes = req.grantScopes ?? [];
    this.core.post(sessionId, {
      type: "approval",
      requestId,
      toolName: req.toolName,
      target: req.target,
      reason: req.reason,
      grantScope: scopes.length > 0 ? scopes.join(", ") : undefined,
      canRemember: req.canRemember,
      danger: req.danger,
    });
    this.notifyIfHidden(sessionId, `NinjaCode needs approval: ${req.toolName} — ${req.reason}`, "Review");

    return new Promise((resolve) => {
      this.core.runtimes.registerApproval({
        sessionId,
        requestId,
        toolName: req.toolName,
        target: req.target,
        resolve: async (v) => {
        // Remember the command type(s) when the tool exposes scopes, else the exact target.
        if (v.approved && v.remember) {
          const keys = scopes.length > 0 ? scopes : [req.target];
          await this.rememberGrants(req.toolName, keys);
        }
        this.core.post(sessionId, {
          type: "approval_resolved",
          requestId,
          approved: v.approved,
          remember: v.remember,
        });
        resolve(v);
        },
      });
    });
  }

  private async rememberGrants(toolName: string, keys: string[]): Promise<void> {
    const grants = this.deps.context.workspaceState.get<string[]>("ninjacode.grants") ?? [];
    for (const key of keys) {
      const entry = `${toolName}:${key}`;
      if (!grants.includes(entry)) grants.push(entry);
    }
    await this.deps.context.workspaceState.update("ninjacode.grants", grants);
  }

  /** Show an interactive question card in the chat and wait for the user's answers. */
  async requestQuestion(sessionId: string, request: AskUserRequest): Promise<AskUserAnswer[]> {
    const requestId = `${Date.now()}_question`;
    this.core.post(sessionId, { type: "question", requestId, questions: request.questions });
    this.notifyIfHidden(
      sessionId,
      `NinjaCode has a question: ${request.questions[0]?.prompt ?? ""}`,
      "Review",
    );
    return new Promise((resolve) => {
      this.core.runtimes.registerQuestion(sessionId, requestId, request.questions, (answers) => {
        this.core.post(sessionId, { type: "question_resolved", requestId, answers });
        resolve(answers);
      });
    });
  }

  /** Pause the run behind a manual-action card until the user confirms they're done. */
  async requestUserAction(
    sessionId: string,
    request: UserActionRequest,
  ): Promise<{ comment?: string }> {
    const requestId = `${Date.now()}_user_action`;
    this.core.post(sessionId, {
      type: "user_action",
      requestId,
      action: request.action,
      reason: request.reason,
    });
    this.notifyIfHidden(
      sessionId,
      t("NinjaCode needs a manual action: {0}", request.action),
      t("Review"),
    );
    return new Promise((resolve) => {
      this.core.runtimes.registerUserAction(sessionId, requestId, request.action, (v) => {
        this.core.post(sessionId, { type: "user_action_resolved", requestId, comment: v.comment });
        resolve(v);
      });
    });
  }

  /** Fire an OS notification when a run finishes while the user is looking elsewhere. */
  notifyRunFinished(sessionId: string, completed: boolean, answer: string): void {
    const summary = answer.replace(/\s+/g, " ").trim().slice(0, 140);
    this.notifyIfHidden(
      sessionId,
      completed
        ? t("NinjaCode finished: {0}", summary || t("Task complete."))
        : t("NinjaCode stopped: {0}", summary || t("Run did not complete.")),
      t("Open Chat"),
    );
  }

  private notifyIfHidden(sessionId: string, message: string, action: string): void {
    if (this.core.isShowing(sessionId)) return;
    void vscode.window.showInformationMessage(message, action).then((choice) => {
      if (choice === action) void this.deps.reveal(sessionId);
    });
  }
}
