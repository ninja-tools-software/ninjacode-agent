import * as vscode from "vscode";
import type { ChatViewProvider } from "./chatViewProvider.js";
import { buildMessages, getQuickProvider, isSensitivePath, relativePath } from "./providerHelper.js";

const SYSTEM_PROMPT = `You are NinjaCode's quick chat assistant, answering a short question about a snippet of
code directly in the editor. Be concise and direct — a few sentences or a short code snippet, not a
full essay. Use markdown for code.`;

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel("NinjaCode Quick Chat");
  return outputChannel;
}

export function registerQuickChat(context: vscode.ExtensionContext, chatProvider: ChatViewProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.quickChat", async () => {
      await runQuickChat(context, chatProvider);
    }),
  );
}

async function runQuickChat(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const question = await vscode.window.showInputBox({
    title: "NinjaCode: Quick Chat",
    prompt: editor && !editor.selection.isEmpty
      ? "Ask something about the selected code"
      : "Ask NinjaCode a quick question",
    placeHolder: "e.g. what does this function do? why might this throw?",
    ignoreFocusOut: true,
  });
  if (!question) return;

  const quick = await getQuickProvider(context, { maxTokens: 1024 });
  if (!quick) return;

  let contextBlock = "";
  if (editor && !isSensitivePath(editor.document.uri.fsPath) && !editor.selection.isEmpty) {
    const rel = relativePath(editor.document.uri);
    const selected = editor.document.getText(editor.selection);
    contextBlock = `\n\nSelected code from ${rel}:\n\`\`\`${editor.document.languageId}\n${selected.slice(0, 6000)}\n\`\`\``;
  }

  const channel = getOutputChannel();
  channel.clear();
  channel.appendLine(`❯ ${question}`);
  channel.appendLine("");
  channel.show(true);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "NinjaCode: thinking…", cancellable: false },
      async () => {
        await quick.llm.completeStreaming(
          {
            messages: buildMessages(SYSTEM_PROMPT, `${question}${contextBlock}`),
            model: quick.model,
            maxTokens: quick.maxTokens,
          },
          (event) => {
            if (event.type === "text_delta") channel.append(event.text);
            else if (event.type === "error") channel.appendLine(`\n[error] ${event.error}`);
          },
        );
      },
    );
    channel.appendLine("\n");
  } catch (e) {
    channel.appendLine(`\n[error] ${(e as Error).message}`);
  }

  const choice = await vscode.window.showInformationMessage(
    "NinjaCode quick chat answered in the output panel.",
    "Continue in Chat",
  );
  if (choice === "Continue in Chat") {
    await chatProvider.sendToChat(`${question}${contextBlock}`);
  }
}
