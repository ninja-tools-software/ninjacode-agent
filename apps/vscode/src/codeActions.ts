import * as vscode from "vscode";
import path from "node:path";
import type { ChatViewProvider } from "./chatViewProvider.js";
import { t } from "./locale.js";
import { showProposedDiff, type ProposedEditsStore } from "./proposedEdits.js";
import { buildMessages, getQuickProvider, isSensitivePath, relativePath, stripCodeFence } from "./providerHelper.js";

const ACTION_KIND = vscode.CodeActionKind.RefactorRewrite;

interface MakeActionOpts {
  title: string;
  command: string;
  kind: vscode.CodeActionKind;
  uri: vscode.Uri;
  range: vscode.Range;
}

interface ProposeRevisionOpts {
  context: vscode.ExtensionContext;
  proposedEdits: ProposedEditsStore;
  uri: vscode.Uri;
  range: vscode.Range;
  systemPrompt: string;
  userPrompt: string;
  progressTitle: string;
}

interface FixOpts {
  context: vscode.ExtensionContext;
  proposedEdits: ProposedEditsStore;
  uri: vscode.Uri;
  range: vscode.Range;
  extraInstruction?: string;
}

function buildSelectionActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
  const uri = document.uri;
  return [
    makeAction({
      title: t("NinjaCode: Explain"),
      command: "ninjacode.codeAction.explain",
      kind: vscode.CodeActionKind.Empty,
      uri,
      range,
    }),
    makeAction({
      title: t("NinjaCode: Fix"),
      command: "ninjacode.codeAction.fix",
      kind: ACTION_KIND,
      uri,
      range,
    }),
    makeAction({
      title: t("NinjaCode: Generate tests"),
      command: "ninjacode.codeAction.generateTests",
      kind: ACTION_KIND,
      uri,
      range,
    }),
    makeAction({
      title: t("NinjaCode: Document"),
      command: "ninjacode.codeAction.document",
      kind: ACTION_KIND,
      uri,
      range,
    }),
    makeAction({
      title: t("NinjaCode: Send to Chat"),
      command: "ninjacode.codeAction.sendToChat",
      kind: vscode.CodeActionKind.Empty,
      uri,
      range,
    }),
  ];
}

function buildDiagnosticActions(
  document: vscode.TextDocument,
  diagnostics: readonly vscode.Diagnostic[],
): vscode.CodeAction[] {
  return diagnostics.map((diagnostic) => {
    const action = new vscode.CodeAction(
      t("Fix with NinjaCode: {0}", truncate(diagnostic.message, 60)),
      vscode.CodeActionKind.QuickFix,
    );
    action.diagnostics = [diagnostic];
    action.isPreferred = diagnostic.severity === vscode.DiagnosticSeverity.Error;
    action.command = {
      title: t("Fix with NinjaCode"),
      command: "ninjacode.codeAction.fixDiagnostic",
      arguments: [document.uri, diagnostic.range, diagnostic.message],
    };
    return action;
  });
}

class NinjaCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.RefactorRewrite,
    vscode.CodeActionKind.Empty,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (document.uri.scheme !== "file" || isSensitivePath(document.uri.fsPath)) return [];

    const actions: vscode.CodeAction[] = [];
    if (!range.isEmpty) actions.push(...buildSelectionActions(document, range));
    actions.push(...buildDiagnosticActions(document, context.diagnostics));
    return actions;
  }
}

function makeAction(opts: MakeActionOpts): vscode.CodeAction {
  const action = new vscode.CodeAction(opts.title, opts.kind);
  action.command = { title: opts.title, command: opts.command, arguments: [opts.uri, opts.range] };
  return action;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function registerCodeActions(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider,
  proposedEdits: ProposedEditsStore,
): void {
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new NinjaCodeActionProvider(), {
      providedCodeActionKinds: NinjaCodeActionProvider.providedCodeActionKinds,
    }),
    vscode.commands.registerCommand("ninjacode.codeAction.explain", (uri: vscode.Uri, range: vscode.Range) =>
      explain(context, uri, range),
    ),
    vscode.commands.registerCommand("ninjacode.codeAction.fix", (uri: vscode.Uri, range: vscode.Range) =>
      fix({ context, proposedEdits, uri, range }),
    ),
    vscode.commands.registerCommand(
      "ninjacode.codeAction.fixDiagnostic",
      (uri: vscode.Uri, range: vscode.Range, message: string) =>
        fix({ context, proposedEdits, uri, range, extraInstruction: `Fix this diagnostic: ${message}` }),
    ),
    vscode.commands.registerCommand(
      "ninjacode.codeAction.generateTests",
      (uri: vscode.Uri, range: vscode.Range) => generateTests(context, proposedEdits, uri, range),
    ),
    vscode.commands.registerCommand("ninjacode.codeAction.document", (uri: vscode.Uri, range: vscode.Range) =>
      documentCode(context, proposedEdits, uri, range),
    ),
    vscode.commands.registerCommand("ninjacode.codeAction.sendToChat", (uri: vscode.Uri, range: vscode.Range) =>
      sendToChat(chatProvider, uri, range),
    ),
  );
}

async function getSelectedText(uri: vscode.Uri, range: vscode.Range): Promise<{ doc: vscode.TextDocument; text: string; rel: string }> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return { doc, text: doc.getText(range), rel: relativePath(uri) };
}

async function explain(context: vscode.ExtensionContext, uri: vscode.Uri, range: vscode.Range): Promise<void> {
  const { text, rel, doc } = await getSelectedText(uri, range);
  const quick = await getQuickProvider(context, { maxTokens: 1024 });
  if (!quick) return;

  const channel = vscode.window.createOutputChannel("NinjaCode Code Actions");
  channel.clear();
  channel.appendLine(`❯ Explain ${rel}`);
  channel.appendLine("");
  channel.show(true);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("NinjaCode: explaining…"), cancellable: false },
    async () => {
      await quick.llm.completeStreaming(
        {
          messages: buildMessages(
            "You are NinjaCode, an expert code reviewer. Explain the given code snippet clearly and concisely.",
            `Explain this ${doc.languageId} code from ${rel}:\n\n\`\`\`${doc.languageId}\n${text}\n\`\`\``,
          ),
          model: quick.model,
          maxTokens: quick.maxTokens,
        },
        (event) => {
          if (event.type === "text_delta") channel.append(event.text);
        },
      );
    },
  );
}

async function proposeRevision(opts: ProposeRevisionOpts): Promise<void> {
  const { doc, rel } = await getSelectedText(opts.uri, opts.range);
  const quick = await getQuickProvider(opts.context, { maxTokens: 8192 });
  if (!quick) return;

  let revised: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: opts.progressTitle, cancellable: false },
    async () => {
      try {
        const completion = await quick.llm.complete({
          messages: buildMessages(opts.systemPrompt, opts.userPrompt),
          model: quick.model,
          maxTokens: quick.maxTokens,
        });
        revised = stripCodeFence(completion.text);
      } catch (e) {
        vscode.window.showErrorMessage(`NinjaCode: ${(e as Error).message}`);
      }
    },
  );
  if (revised === undefined) return;

  const before = doc.getText();
  const after =
    before.slice(0, doc.offsetAt(opts.range.start)) + revised + before.slice(doc.offsetAt(opts.range.end));
  if (after === before) {
    vscode.window.showInformationMessage(t("NinjaCode: no changes suggested."));
    return;
  }
  opts.proposedEdits.set({ path: rel, before, after });
  await showProposedDiff(rel);

  const choice = await vscode.window.showInformationMessage(
    t("NinjaCode proposed an edit to {0}.", rel),
    t("Accept"),
    t("Reject"),
  );
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (choice === t("Accept") && folder) {
    await opts.proposedEdits.accept(folder.uri.fsPath, rel);
  } else if (choice === t("Reject")) {
    await opts.proposedEdits.reject(rel);
  }
}

async function fix(opts: FixOpts): Promise<void> {
  const { text, doc, rel } = await getSelectedText(opts.uri, opts.range);
  await proposeRevision({
    context: opts.context,
    proposedEdits: opts.proposedEdits,
    uri: opts.uri,
    range: opts.range,
    systemPrompt:
      "You are NinjaCode's inline code fixer. Output ONLY the corrected code for the given range — no " +
      "explanations, no markdown fences.",
    userPrompt: [
      `File: ${rel} (${doc.languageId})`,
      opts.extraInstruction ?? "Fix any bugs, edge cases, or issues in this code.",
      "",
      "Code:",
      "```",
      text,
      "```",
    ].join("\n"),
    progressTitle: t("NinjaCode: fixing…"),
  });
}

async function documentCode(
  context: vscode.ExtensionContext,
  proposedEdits: ProposedEditsStore,
  uri: vscode.Uri,
  range: vscode.Range,
): Promise<void> {
  const { text, doc, rel } = await getSelectedText(uri, range);
  await proposeRevision({
    context,
    proposedEdits,
    uri,
    range,
    systemPrompt:
      "You are NinjaCode's documentation writer. Add clear doc comments/docstrings to the given code " +
      "without changing its behavior. Output ONLY the revised code — no explanations, no markdown fences.",
    userPrompt: [
      `File: ${rel} (${doc.languageId})`,
      "Add documentation comments to this code:",
      "```",
      text,
      "```",
    ].join("\n"),
    progressTitle: t("NinjaCode: documenting…"),
  });
}

async function generateTests(
  context: vscode.ExtensionContext,
  proposedEdits: ProposedEditsStore,
  uri: vscode.Uri,
  range: vscode.Range,
): Promise<void> {
  const { text, doc, rel } = await getSelectedText(uri, range);
  const quick = await getQuickProvider(context, { maxTokens: 8192 });
  if (!quick) return;

  let testsCode: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("NinjaCode: generating tests…"), cancellable: false },
    async () => {
      try {
        const completion = await quick.llm.complete({
          messages: buildMessages(
            "You are NinjaCode's test generator. Output ONLY the complete contents of a new test file " +
              "covering the given code — no explanations, no markdown fences.",
            [
              `File under test: ${rel} (${doc.languageId})`,
              "Generate unit tests for this code:",
              "```",
              text,
              "```",
            ].join("\n"),
          ),
          model: quick.model,
          maxTokens: quick.maxTokens,
        });
        testsCode = stripCodeFence(completion.text);
      } catch (e) {
        vscode.window.showErrorMessage(`NinjaCode: ${(e as Error).message}`);
      }
    },
  );
  if (!testsCode) return;

  const testPath = guessTestPath(rel);
  proposedEdits.set({ path: testPath, before: "", after: testsCode });
  await showProposedDiff(testPath);

  const choice = await vscode.window.showInformationMessage(
    t("NinjaCode proposed new tests at {0}.", testPath),
    t("Accept"),
    t("Reject"),
  );
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (choice === t("Accept") && folder) {
    await proposedEdits.accept(folder.uri.fsPath, testPath);
  } else if (choice === t("Reject")) {
    await proposedEdits.reject(testPath);
  }
}

function guessTestPath(rel: string): string {
  const ext = path.extname(rel);
  const base = rel.slice(0, -ext.length || undefined);
  return `${base}.test${ext}`;
}

async function sendToChat(chatProvider: ChatViewProvider, uri: vscode.Uri, range: vscode.Range): Promise<void> {
  const { text, doc, rel } = await getSelectedText(uri, range);
  const message = `About this code from \`${rel}\`:\n\n\`\`\`${doc.languageId}\n${text}\n\`\`\`\n\n`;
  await chatProvider.sendToChat(message, { submit: false });
}
