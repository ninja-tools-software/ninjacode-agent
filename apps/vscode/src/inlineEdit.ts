import * as vscode from "vscode";
import { t } from "./locale.js";
import type { ChatViewProvider } from "./chatViewProvider.js";
import { showProposedDiff, type ProposedEditsStore } from "./proposedEdits.js";
import { buildMessages, getQuickProvider, isSensitivePath, relativePath, stripCodeFence } from "./providerHelper.js";

const SYSTEM_PROMPT = `You are NinjaCode's inline code editor. You are given a file (or a selected excerpt) and an
instruction describing a change to make. Respond with ONLY the complete revised code for exactly the
range you were given — no explanations, no markdown code fences, no commentary before or after.
Preserve indentation and surrounding style. If the instruction cannot be applied, return the
original code unchanged.`;

/** Tracks the most recent inline-edit proposal so the accept/reject commands know what to act on. */
let lastInlineEditPath: string | undefined;

export function registerInlineEdit(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider,
  proposedEdits: ProposedEditsStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ninjacode.inlineEdit", async () => {
      await runInlineEdit(context, proposedEdits);
    }),
    vscode.commands.registerCommand("ninjacode.inlineEdit.accept", async (relPath?: string) => {
      await acceptInlineEdit(proposedEdits, relPath);
    }),
    vscode.commands.registerCommand("ninjacode.inlineEdit.reject", async (relPath?: string) => {
      await rejectInlineEdit(proposedEdits, relPath);
    }),
    vscode.commands.registerCommand("ninjacode.inlineEdit.continueInChat", async (relPath?: string) => {
      await continueInChat(chatProvider, proposedEdits, relPath);
    }),
  );
}

async function generateInlineRevision(
  context: vscode.ExtensionContext,
  userPrompt: string,
): Promise<string | undefined> {
  const quick = await getQuickProvider(context, { maxTokens: 8192 });
  if (!quick) return undefined;

  let revised: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("NinjaCode: generating edit…"), cancellable: false },
    async () => {
      try {
        const completion = await quick.llm.complete({
          messages: buildMessages(SYSTEM_PROMPT, userPrompt),
          model: quick.model,
          maxTokens: quick.maxTokens,
        });
        revised = stripCodeFence(completion.text);
      } catch (e) {
        vscode.window.showErrorMessage(t("NinjaCode inline edit failed: {0}", (e as Error).message));
      }
    },
  );
  return revised;
}

async function applyInlineEditResult(opts: {
  proposedEdits: ProposedEditsStore;
  editor: vscode.TextEditor;
  range: vscode.Range;
  rel: string;
  revised: string;
}): Promise<void> {
  const { proposedEdits, editor, range, rel, revised } = opts;
  const before = editor.document.getText();
  const after =
    before.slice(0, editor.document.offsetAt(range.start)) +
    revised +
    before.slice(editor.document.offsetAt(range.end));

  proposedEdits.set({ path: rel, before, after });
  lastInlineEditPath = rel;
  await showProposedDiff(rel);

  const accept = t("Accept");
  const reject = t("Reject");
  const continueChat = t("Continue in Chat");
  const choice = await vscode.window.showInformationMessage(
    t("NinjaCode proposed an edit to {0}.", rel),
    accept,
    reject,
    continueChat,
  );
  if (choice === accept) {
    await acceptInlineEdit(proposedEdits, rel);
  } else if (choice === reject) {
    await rejectInlineEdit(proposedEdits, rel);
  } else if (choice === continueChat) {
    await vscode.commands.executeCommand("ninjacode.inlineEdit.continueInChat", rel);
  }
}

async function runInlineEdit(
  context: vscode.ExtensionContext,
  proposedEdits: ProposedEditsStore,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(t("NinjaCode: open a file to use inline edit."));
    return;
  }
  if (isSensitivePath(editor.document.uri.fsPath)) {
    vscode.window.showWarningMessage(t("NinjaCode: inline edit is disabled for sensitive files."));
    return;
  }

  const instruction = await vscode.window.showInputBox({
    title: t("NinjaCode: Inline Edit"),
    prompt: t("Describe the change to make"),
    placeHolder: t("e.g. add null checks, extract this into a helper, rename x to count…"),
    ignoreFocusOut: true,
  });
  if (!instruction) return;

  const hasSelection = !editor.selection.isEmpty;
  const range = hasSelection
    ? editor.selection
    : new vscode.Range(0, 0, editor.document.lineCount, 0);
  const original = editor.document.getText(range);
  const rel = relativePath(editor.document.uri);

  const userPrompt = [
    `File: ${rel} (language: ${editor.document.languageId})`,
    hasSelection ? "Editing the selected excerpt below." : "Editing the entire file below.",
    `Instruction: ${instruction}`,
    "",
    "Code:",
    "```",
    original,
    "```",
  ].join("\n");

  const revised = await generateInlineRevision(context, userPrompt);
  if (revised === undefined) return;
  if (revised.trim() === original.trim()) {
    vscode.window.showInformationMessage(t("NinjaCode: no changes suggested."));
    return;
  }

  await applyInlineEditResult({ proposedEdits, editor, range, rel, revised });
}

async function acceptInlineEdit(proposedEdits: ProposedEditsStore, relPath?: string): Promise<void> {
  const p = relPath ?? lastInlineEditPath;
  if (!p) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  await proposedEdits.accept(folder.uri.fsPath, p);
  vscode.window.showInformationMessage(t("NinjaCode: applied edit to {0}.", p));
  if (lastInlineEditPath === p) lastInlineEditPath = undefined;
}

async function rejectInlineEdit(proposedEdits: ProposedEditsStore, relPath?: string): Promise<void> {
  const p = relPath ?? lastInlineEditPath;
  if (!p) return;
  await proposedEdits.reject(p);
  vscode.window.showInformationMessage(t("NinjaCode: discarded edit to {0}.", p));
  if (lastInlineEditPath === p) lastInlineEditPath = undefined;
}

async function continueInChat(
  chatProvider: ChatViewProvider,
  proposedEdits: ProposedEditsStore,
  relPath?: string,
): Promise<void> {
  const p = relPath ?? lastInlineEditPath;
  const edit = p ? proposedEdits.get(p) : undefined;
  const text = edit
    ? `Let's continue iterating on the inline edit for \`${p}\`:\n\n\`\`\`diff\n${edit.after}\n\`\`\``
    : "Let's continue iterating on the inline edit.";
  await chatProvider.sendToChat(text, { submit: false });
}
