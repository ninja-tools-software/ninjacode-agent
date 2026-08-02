import * as vscode from "vscode";

/**
 * Approximation of "Next Edit Suggestions": after a small edit settles, look for
 * other lines elsewhere in the same file that still contain the *old* text — a
 * common sign the same fix needs to be repeated (renames, duplicated bug fixes,
 * copy-pasted blocks). No LLM call is needed; this is a cheap textual heuristic.
 */

const DEBOUNCE_MS = 600;
const MAX_CHANGED_LINES = 3;
const MIN_LINE_LENGTH = 4;

interface Suggestion {
  uri: vscode.Uri;
  line: number;
  oldTrim: string;
  newTrim: string;
}

const baselines = new Map<string, string[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let suggestion: Suggestion | undefined;

let decorationType: vscode.TextEditorDecorationType;
let statusBarItem: vscode.StatusBarItem;
let lensProvider: NextEditCodeLensProvider;

class NextEditCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!suggestion || suggestion.uri.toString() !== document.uri.toString()) return [];
    const line = Math.min(suggestion.line, document.lineCount - 1);
    const range = document.lineAt(line).range;
    return [
      new vscode.CodeLens(range, {
        title: "✦ NinjaCode: apply same edit here (Tab)",
        command: "ninjacode.nextEdit.accept",
      }),
      new vscode.CodeLens(range, {
        title: "Dismiss",
        command: "ninjacode.nextEdit.dismiss",
      }),
    ];
  }
}

export function registerNextEdit(context: vscode.ExtensionContext): void {
  decorationType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    border: "1px dashed",
    borderColor: new vscode.ThemeColor("editorInfo.foreground"),
    overviewRulerColor: new vscode.ThemeColor("editorInfo.foreground"),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBarItem.command = "ninjacode.nextEdit.jump";
  statusBarItem.text = "$(sparkle) Next edit";
  statusBarItem.tooltip = "NinjaCode: jump to the next suggested edit (Tab)";

  lensProvider = new NextEditCodeLensProvider();

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === "file") baselines.set(doc.uri.toString(), doc.getText().split("\n"));
  }

  context.subscriptions.push(
    decorationType,
    statusBarItem,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, lensProvider),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme === "file") baselines.set(doc.uri.toString(), doc.getText().split("\n"));
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      baselines.delete(key);
      const timer = timers.get(key);
      if (timer) clearTimeout(timer);
      timers.delete(key);
      if (suggestion?.uri.toString() === key) clearSuggestion();
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== "file" || event.contentChanges.length === 0) return;
      scheduleAnalysis(event.document);
    }),
    vscode.commands.registerCommand("ninjacode.nextEdit.jump", () => jumpOrAccept()),
    vscode.commands.registerCommand("ninjacode.nextEdit.accept", () => acceptActive()),
    vscode.commands.registerCommand("ninjacode.nextEdit.dismiss", () => clearSuggestion()),
  );
}

function scheduleAnalysis(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      analyze(document);
    }, DEBOUNCE_MS),
  );
}

function diffRange(oldLines: string[], newLines: string[]): { start: number; oldEnd: number; newEnd: number } {
  let start = 0;
  const maxStart = Math.min(oldLines.length, newLines.length);
  while (start < maxStart && oldLines[start] === newLines[start]) start++;

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }
  return { start, oldEnd, newEnd };
}

function findRenamedLine(
  newLines: string[],
  start: number,
  newEnd: number,
  oldTrim: string,
): number | undefined {
  for (let i = 0; i < newLines.length; i++) {
    if (i >= start && i <= newEnd) continue;
    if (newLines[i]!.trim() === oldTrim) return i;
  }
  return undefined;
}

function analyze(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const oldLines = baselines.get(key);
  const newLines = document.getText().split("\n");
  baselines.set(key, newLines);
  if (!oldLines) return;

  const { start, oldEnd, newEnd } = diffRange(oldLines, newLines);
  if (start > oldEnd && start > newEnd) return;
  if (oldEnd - start >= MAX_CHANGED_LINES || newEnd - start >= MAX_CHANGED_LINES) return;

  const oldTrim = (oldLines[start] ?? "").trim();
  const newTrim = (newLines[start] ?? "").trim();
  if (oldTrim.length < MIN_LINE_LENGTH || oldTrim === newTrim) {
    if (suggestion?.uri.toString() === key) clearSuggestion();
    return;
  }

  const matchLine = findRenamedLine(newLines, start, newEnd, oldTrim);
  if (matchLine !== undefined) {
    setSuggestion({ uri: document.uri, line: matchLine, oldTrim, newTrim });
    return;
  }
  if (suggestion?.uri.toString() === key) clearSuggestion();
}

function setSuggestion(next: Suggestion): void {
  suggestion = next;
  void vscode.commands.executeCommand("setContext", "ninjacode.nextEditVisible", true);
  statusBarItem.show();
  lensProvider.refresh();
  decorateActiveEditor();
}

function clearSuggestion(): void {
  if (!suggestion) return;
  suggestion = undefined;
  void vscode.commands.executeCommand("setContext", "ninjacode.nextEditVisible", false);
  statusBarItem.hide();
  lensProvider.refresh();
  for (const editor of vscode.window.visibleTextEditors) editor.setDecorations(decorationType, []);
}

function decorateActiveEditor(): void {
  if (!suggestion) return;
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === suggestion!.uri.toString(),
  );
  if (!editor) return;
  const line = Math.min(suggestion.line, editor.document.lineCount - 1);
  editor.setDecorations(decorationType, [editor.document.lineAt(line).range]);
}

async function jumpOrAccept(): Promise<void> {
  if (!suggestion) return;
  const editor = await revealSuggestionEditor();
  if (!editor) return;
  const line = Math.min(suggestion.line, editor.document.lineCount - 1);
  if (editor.selection.active.line === line) {
    await acceptActive();
    return;
  }
  const range = editor.document.lineAt(line).range;
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

async function acceptActive(): Promise<void> {
  if (!suggestion) return;
  const editor = await revealSuggestionEditor();
  if (!editor) return;
  const line = Math.min(suggestion.line, editor.document.lineCount - 1);
  const lineInfo = editor.document.lineAt(line);
  const indent = /^\s*/.exec(lineInfo.text)?.[0] ?? "";
  const replacement = `${indent}${suggestion.newTrim}`;
  await editor.edit((eb) => eb.replace(lineInfo.range, replacement));
  clearSuggestion();
}

async function revealSuggestionEditor(): Promise<vscode.TextEditor | undefined> {
  if (!suggestion) return undefined;
  const existing = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === suggestion!.uri.toString(),
  );
  if (existing) return existing;
  try {
    const doc = await vscode.workspace.openTextDocument(suggestion.uri);
    return await vscode.window.showTextDocument(doc);
  } catch {
    return undefined;
  }
}
