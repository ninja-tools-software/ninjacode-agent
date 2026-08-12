import path from "node:path";
import * as vscode from "vscode";
import type { ProviderKind } from "@ninjacode/providers";
import type { ChatViewProvider } from "./chatViewProvider.js";
import { ChatViewProvider as ChatViewProviderClass } from "./chatViewProvider.js";
import { CheckpointsTreeProvider } from "./checkpointsTree.js";
import { registerAddToChatCommands } from "./chat/addToChatCommands.js";
import { registerCodeActions } from "./codeActions.js";
import { registerCodeReview } from "./codeReview.js";
import { registerInlineCompletions } from "./completions.js";
import { registerInlineEdit } from "./inlineEdit.js";
import { registerChatParticipant } from "./chatParticipant.js";
import { registerLmProvider } from "./lmProvider.js";
import { registerNextEdit } from "./nextEdit.js";
import { registerQuickChat } from "./quickChat.js";
import { setSecretApiKey } from "./secrets.js";

export function registerChatView(context: vscode.ExtensionContext, provider: ChatViewProvider): void {
  const webviewOpts = { webviewOptions: { retainContextWhenHidden: true } };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProviderClass.viewType, provider, webviewOpts),
    vscode.window.registerWebviewViewProvider(ChatViewProviderClass.viewTypeLeft, provider, webviewOpts),
  );
}

export function registerSessionCommands(context: vscode.ExtensionContext, provider: ChatViewProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.newSession", () => provider.newSession()),
    vscode.commands.registerCommand("ninjacode.forkSession", () => provider.forkActiveSession()),
    vscode.commands.registerCommand("ninjacode.renameSession", () => provider.renameActiveSession()),
    vscode.commands.registerCommand("ninjacode.exportSession", () => provider.exportActiveSession()),
    vscode.commands.registerCommand("ninjacode.pinSession", () => provider.togglePinActiveSession()),
    vscode.commands.registerCommand("ninjacode.archiveSession", () => provider.toggleArchiveActiveSession()),
    vscode.commands.registerCommand("ninjacode.executePlan", () => provider.executePlan()),
  );
}

export function registerEditCommands(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
  checkpointsTree: CheckpointsTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.restoreCheckpoint", async () => {
      await provider.restoreCheckpoint();
      checkpointsTree.refresh();
    }),
    vscode.commands.registerCommand("ninjacode.stopAgent", () => {
      provider.stopActiveSession();
    }),
    vscode.commands.registerCommand("ninjacode.acceptAllEdits", async () => {
      await provider.acceptAllEdits();
    }),
    vscode.commands.registerCommand("ninjacode.rejectAllEdits", () => {
      void provider.proposedEdits.rejectAll(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    }),
    vscode.commands.registerCommand("ninjacode.reviewEdit", async (path?: string) => {
      const p =
        path ??
        (await vscode.window.showQuickPick(provider.proposedEdits.paths(), {
          title: "Review proposed edit",
        }));
      if (p) {
        const { showProposedDiff } = await import("./proposedEdits.js");
        await showProposedDiff(p);
      }
    }),
  );
}

/**
 * Scaffold `.ninjacode/verify.json` from the workspace shape. Completion
 * verification only ever runs commands the user can see and edit, so the file
 * is written and opened rather than applied silently.
 */
export function registerInitVerifyCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.initVerifyConfig", async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showWarningMessage(vscode.l10n.t("Open a folder first."));
        return;
      }
      const { scaffoldVerifyConfig } = await import("@ninjacode/core");
      const result = await scaffoldVerifyConfig(root, path.join(root, ".ninjacode"));
      if (result.status === "created" && result.commands.length === 0) {
        vscode.window.showInformationMessage(
          vscode.l10n.t("No verification command could be inferred — add your own."),
        );
      } else if (result.status === "created") {
        vscode.window.showInformationMessage(
          vscode.l10n.t("Verification config created: {0}", result.commands.join(", ")),
        );
      }
      await vscode.window.showTextDocument(vscode.Uri.file(result.file));
    }),
  );
}

export function registerApiKeyCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.setApiKey", async () => {
      const kinds: ProviderKind[] = [
        "anthropic",
        "openai",
        "deepseek",
        "openrouter",
        "moonshot",
        "glm",
        "mistral",
        "mammouth",
        "openai-compatible",
      ];
      const kind = (await vscode.window.showQuickPick(kinds, {
        title: "Provider for API key",
      })) as ProviderKind | undefined;
      if (!kind) return;
      const key = await vscode.window.showInputBox({
        title: `NinjaCode API Key (${kind})`,
        password: true,
        prompt: "Stored securely in VS Code SecretStorage",
        ignoreFocusOut: true,
      });
      if (key) {
        await setSecretApiKey(context, key, kind);
        vscode.window.showInformationMessage(`NinjaCode: API key saved for ${kind}.`);
      }
    }),
  );
}

export function registerEditorSurfaces(context: vscode.ExtensionContext, provider: ChatViewProvider): void {
  const registerSurface = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (e) {
      console.warn(`NinjaCode: ${name} registration failed`, e);
    }
  };

  registerSurface("inlineEdit", () => registerInlineEdit(context, provider, provider.proposedEdits));
  registerSurface("quickChat", () => registerQuickChat(context, provider));
  registerSurface("inlineCompletions", () => registerInlineCompletions(context));
  registerSurface("nextEdit", () => registerNextEdit(context));
  registerSurface("codeActions", () => registerCodeActions(context, provider, provider.proposedEdits));
  registerSurface("codeReview", () => registerCodeReview(context));
  registerSurface("addToChat", () => registerAddToChatCommands(context, provider));
}

export function registerNativeChatIntegrations(context: vscode.ExtensionContext): void {
  try {
    const chatParticipant = registerChatParticipant(context);
    if (chatParticipant) context.subscriptions.push(chatParticipant);
  } catch (e) {
    console.warn("NinjaCode: failed to register chat participant", e);
  }

  try {
    const lmProvider = registerLmProvider(context);
    if (lmProvider) context.subscriptions.push(lmProvider);
  } catch (e) {
    console.warn("NinjaCode: failed to register language model provider", e);
  }
}
