import * as vscode from "vscode";
import { ChatViewProvider } from "./chatViewProvider.js";
import { PLAN_EDITOR_VIEW_TYPE } from "./planEditorProvider.js";
import { SettingsPanel } from "./settingsPanel.js";
import { ProposedContentProvider } from "./proposedEdits.js";
import { CheckpointsTreeProvider } from "./checkpointsTree.js";
import {
  closeCommandFor,
  getChatLocation,
  syncChatLocationContext,
} from "./chat/chatLocation.js";
import {
  registerApiKeyCommand,
  registerChatView,
  registerEditCommands,
  registerEditorSurfaces,
  registerInitVerifyCommand,
  registerNativeChatIntegrations,
  registerSessionCommands,
} from "./extensionCommands.js";
import { t } from "./locale.js";
import { configureToolUiL10n } from "./toolUi.js";

let activeProvider: ChatViewProvider | undefined;

function registerChatToggle(context: vscode.ExtensionContext, provider: ChatViewProvider): void {
  const chatStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 88);
  chatStatusBar.command = "ninjacode.toggleChat";
  chatStatusBar.text = "$(ninjacode-shuriken) NinjaCode";
  chatStatusBar.tooltip = "Toggle NinjaCode Chat (Cmd+Shift+L / Ctrl+Shift+L)";
  chatStatusBar.show();

  context.subscriptions.push(
    chatStatusBar,
    vscode.commands.registerCommand("ninjacode.openChat", () => provider.focusActiveChat()),
    vscode.commands.registerCommand("ninjacode.toggleChat", async () => {
      try {
        if (provider.isVisible()) {
          await vscode.commands.executeCommand(closeCommandFor(getChatLocation()));
        } else {
          await provider.focusActiveChat();
        }
      } catch (e) {
        console.warn("NinjaCode: toggleChat failed, focusing chat", e);
        await provider.focusActiveChat();
      }
    }),
  );
}

function registerChatLocationSync(context: vscode.ExtensionContext): void {
  void syncChatLocationContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ninjacode.chatLocation")) {
        void syncChatLocationContext();
      }
    }),
  );
}

function registerSharedInfrastructure(
  context: vscode.ExtensionContext,
  provider: ChatViewProvider,
): CheckpointsTreeProvider {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path === "/auth" || uri.path.endsWith("auth")) {
          await provider.handleAuthUri(uri);
        }
      },
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      "ninjacode-proposed",
      new ProposedContentProvider(provider.proposedEdits),
    ),
    vscode.window.registerCustomEditorProvider(PLAN_EDITOR_VIEW_TYPE, provider.planEditor, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("ninjacode.openSettings", () => {
      SettingsPanel.show(context, provider.settings);
    }),
    vscode.commands.registerCommand("ninjacode.showWelcome", () => provider.showWelcome()),
  );

  const checkpointsTree = new CheckpointsTreeProvider(() => provider.lastCheckpoints);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ninjacode.checkpointsView", checkpointsTree),
    vscode.window.registerTreeDataProvider("ninjacode.checkpointsViewLeft", checkpointsTree),
  );
  provider.proposedEdits.onDidChange(() => checkpointsTree.refresh());
  return checkpointsTree;
}

export function activate(context: vscode.ExtensionContext): void {
  configureToolUiL10n(t);

  let provider: ChatViewProvider;
  try {
    provider = new ChatViewProvider(context);
    activeProvider = provider;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("NinjaCode: failed to construct ChatViewProvider", e);
    vscode.window.showErrorMessage(`NinjaCode failed to start: ${message}`);
    context.subscriptions.push(
      vscode.commands.registerCommand("ninjacode.toggleChat", () => {
        vscode.window.showErrorMessage(`NinjaCode is not available: ${message}`);
      }),
      vscode.commands.registerCommand("ninjacode.openChat", () => {
        vscode.window.showErrorMessage(`NinjaCode is not available: ${message}`);
      }),
    );
    return;
  }

  registerChatView(context, provider);
  registerChatLocationSync(context);
  const checkpointsTree = registerSharedInfrastructure(context, provider);
  registerChatToggle(context, provider);
  registerApiKeyCommand(context);
  registerInitVerifyCommand(context);
  registerSessionCommands(context, provider);
  registerEditCommands(context, provider, checkpointsTree);
  registerEditorSurfaces(context, provider);
  registerNativeChatIntegrations(context);
}

export function deactivate(): Promise<void> | void {
  const provider = activeProvider;
  activeProvider = undefined;
  return provider?.dispose();
}
