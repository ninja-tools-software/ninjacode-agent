import * as vscode from "vscode";
import { t } from "./locale.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { buildMessages, getQuickProvider, isSensitivePath } from "./providerHelper.js";

const SYSTEM_PROMPT = `You are NinjaCode performing an automated code review of a git diff (or, if no diff is
available, of the currently open files). Report only genuine, actionable issues: bugs, edge cases,
security problems, and clear style/correctness concerns. Ignore nitpicks and formatting.

Respond with ONE finding per line, in exactly this format (no extra text, no markdown):
path/to/file.ext:LINE:SEVERITY: message

SEVERITY must be one of: error, warning, info. LINE must be a line number in the final version of the
file. If there are no issues, respond with the single word: NONE.`;

const FINDING_RE = /^(.+?):(\d+):\s*(error|warning|info)\s*:\s*(.+)$/i;

let reviewCollection: vscode.DiagnosticCollection | undefined;

export function registerCodeReview(context: vscode.ExtensionContext): void {
  reviewCollection = vscode.languages.createDiagnosticCollection("ninjacode.review");
  context.subscriptions.push(
    reviewCollection,
    vscode.commands.registerCommand("ninjacode.reviewChanges", () => runReview(context)),
  );
}

async function runReview(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !reviewCollection) {
    if (!folder) vscode.window.showWarningMessage(t("NinjaCode: open a workspace folder first."));
    return;
  }

  const quick = await getQuickProvider(context, { maxTokens: 2048 });
  if (!quick) return;

  const subject = await loadReviewSubject(folder.uri.fsPath);
  if (!subject.text.trim()) {
    vscode.window.showInformationMessage(t("NinjaCode: nothing to review (no git changes, no open files)."));
    return;
  }

  reviewCollection.clear();
  const responseText = await fetchReviewResponse(quick, subject);
  if (responseText === undefined) return;
  await publishReviewFindings(folder.uri.fsPath, responseText);
}

async function loadReviewSubject(workspaceRoot: string): Promise<{ text: string; usingDiff: boolean }> {
  let text = await getGitDiff(workspaceRoot);
  if (text) return { text, usingDiff: true };
  text = await getOpenFilesSnapshot();
  return { text, usingDiff: false };
}

async function fetchReviewResponse(
  quick: NonNullable<Awaited<ReturnType<typeof getQuickProvider>>>,
  subject: { text: string; usingDiff: boolean },
): Promise<string | undefined> {
  let responseText: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t("NinjaCode: reviewing changes…"), cancellable: false },
    async () => {
      try {
        const completion = await quick.llm.complete({
          messages: buildMessages(
            SYSTEM_PROMPT,
            `${subject.usingDiff ? "Git diff" : "Open files"} to review:\n\n${subject.text.slice(0, 24000)}`,
          ),
          model: quick.model,
          maxTokens: quick.maxTokens,
        });
        responseText = completion.text;
      } catch (e) {
        vscode.window.showErrorMessage(t("NinjaCode review failed: {0}", (e as Error).message));
      }
    },
  );
  return responseText;
}

async function publishReviewFindings(workspaceRoot: string, responseText: string): Promise<void> {
  if (!reviewCollection) return;
  if (responseText.trim().toUpperCase() === "NONE") {
    vscode.window.showInformationMessage(t("NinjaCode: no issues found."));
    return;
  }

  const byFile = parseReviewFindings(responseText);
  let total = 0;
  for (const [rel, diagnostics] of byFile) {
    reviewCollection.set(vscode.Uri.file(path.join(workspaceRoot, rel)), diagnostics);
    total += diagnostics.length;
  }

  if (total === 0) {
    vscode.window.showInformationMessage(t("NinjaCode: review completed, but the response couldn't be parsed."));
    return;
  }
  const showProblems = t("Show Problems");
  const choice = await vscode.window.showInformationMessage(
    t("NinjaCode review found {0} issue(s) across {1} file(s).", total, byFile.size),
    showProblems,
  );
  if (choice === showProblems) {
    await vscode.commands.executeCommand("workbench.panel.markers.view.focus");
  }
}

function parseReviewFindings(responseText: string): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const line of responseText.split("\n")) {
    const match = FINDING_RE.exec(line.trim());
    if (!match) continue;
    const [, rel, lineStr, severity, message] = match;
    const lineNum = Math.max(0, Number.parseInt(lineStr!, 10) - 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineNum, 0, lineNum, 200),
      message!.trim(),
      severityFrom(severity!),
    );
    diagnostic.source = "NinjaCode Review";
    const list = byFile.get(rel!) ?? [];
    list.push(diagnostic);
    byFile.set(rel!, list);
  }
  return byFile;
}

function severityFrom(s: string): vscode.DiagnosticSeverity {
  switch (s.toLowerCase()) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

function getGitDiff(workspaceRoot: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("git", ["diff", "HEAD", "--no-color"], { cwd: workspaceRoot });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.on("error", () => resolve(""));
    child.on("close", (code) => resolve(code === 0 ? out.trim() : ""));
  });
}

async function getOpenFilesSnapshot(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const parts: string[] = [];
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme !== "file" || doc.isUntitled) continue;
    if (isSensitivePath(doc.uri.fsPath)) continue;
    const rel = folder ? path.relative(folder.uri.fsPath, doc.uri.fsPath) : doc.uri.fsPath;
    if (rel.startsWith("..")) continue;
    parts.push(`--- ${rel} ---\n${doc.getText().slice(0, 6000)}`);
  }
  return parts.join("\n\n");
}
