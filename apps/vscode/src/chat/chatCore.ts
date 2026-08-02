import * as vscode from "vscode";
import path from "node:path";
import type { SessionSummary } from "@ninjacode/core";
import type { HostToWebview } from "../protocol.js";
import { SessionRuntimeManager } from "../sessionRuntime.js";
import { mirrorEventIntoUi } from "../sessionMirrorUi.js";
import {
  chatViewIdFor,
  containerCommandFor,
  getChatLocation,
  syncChatLocationContext,
} from "./chatLocation.js";

/**
 * The small shared kernel every chat controller needs: the webview transport, which
 * session is active, and the per-session runtimes. Deliberately narrow — anything
 * domain-specific belongs to a controller, not here.
 */
export class ChatCore {
  view?: vscode.WebviewView;
  visible = false;
  activeSessionId?: string;
  sessionsList: SessionSummary[] = [];
  readonly runtimes = new SessionRuntimeManager();

  /**
   * Route an event to the webview iff `sessionId` is the active session (or is undefined,
   * meaning the payload is global). Session events are always mirrored into that session's
   * runtime UI state, so switching back later re-hydrates correctly even if it wasn't visible.
   */
  post(sessionId: string | undefined, payload: HostToWebview): void {
    if (sessionId) {
      if (payload.type !== "hydrate" && payload.type !== "settings") {
        mirrorEventIntoUi(this.runtimes.getOrCreate(sessionId).ui, payload);
      }
      if (sessionId !== this.activeSessionId) return;
    }
    void this.view?.webview.postMessage(payload);
  }

  isVisible(): boolean {
    return this.visible && Boolean(this.view?.visible);
  }

  /** True when the chat is on screen *and* showing this session. */
  isShowing(sessionId: string): boolean {
    return this.isVisible() && this.activeSessionId === sessionId;
  }

  workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  agentDir(): string | undefined {
    const root = this.workspaceRoot();
    return root ? path.join(root, ".ninjacode") : undefined;
  }

  /** Reveal whichever chat view matches the configured panel side. */
  async focusChat(): Promise<void> {
    const location = getChatLocation();
    // Ensure the location context is set so the matching view's `when` clause is true.
    await syncChatLocationContext();
    const viewId = chatViewIdFor(location);
    try {
      await vscode.commands.executeCommand(`${viewId}.focus`);
      return;
    } catch {
      // Fall through: open the container first, then focus the view.
    }
    await vscode.commands.executeCommand(containerCommandFor(location)).then(undefined, () => undefined);
    await vscode.commands.executeCommand(`${viewId}.focus`).then(undefined, () => undefined);
  }
}
