import * as vscode from "vscode";
import { buildMessages, getQuickProvider, isSensitivePath } from "./providerHelper.js";

const DEBOUNCE_MS = 300;
const MAX_PREFIX_CHARS = 4000;
const MAX_SUFFIX_CHARS = 1000;
const MAX_COMPLETION_TOKENS = 128;

const SYSTEM_PROMPT = `You are a code completion engine embedded in an editor. Given the code immediately before
and after the cursor, output ONLY the text that should be inserted at the cursor to continue the code
naturally. Do not repeat the prefix or suffix. Do not use markdown code fences. Keep it short — usually
a single line or a small statement. If nothing sensible completes the code, output nothing.`;

function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sanitizeCompletion(text: string, suffix: string): string {
  let out = text.replace(/^```[^\n]*\n?/, "").replace(/```$/, "");
  // Avoid duplicating whatever already follows the cursor on the same line.
  const suffixLine = suffix.split("\n", 1)[0] ?? "";
  if (suffixLine && out.endsWith(suffixLine)) {
    out = out.slice(0, out.length - suffixLine.length);
  }
  return out;
}

class NinjaCodeInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    inlineContext: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    void inlineContext;
    const cfg = vscode.workspace.getConfiguration("ninjacode");
    if (!(cfg.get<boolean>("inlineCompletions.enabled") ?? true)) return undefined;
    if (document.uri.scheme !== "file") return undefined;
    if (isSensitivePath(document.uri.fsPath)) return undefined;

    await delay(DEBOUNCE_MS, token);
    if (token.isCancellationRequested) return undefined;

    const offset = document.offsetAt(position);
    const fullText = document.getText();
    const prefix = fullText.slice(Math.max(0, offset - MAX_PREFIX_CHARS), offset);
    const suffix = fullText.slice(offset, offset + MAX_SUFFIX_CHARS);
    if (!prefix.trim()) return undefined;

    const modelOverride = cfg.get<string>("inlineCompletions.model") || undefined;
    const quick = await getQuickProvider(this.context, {
      modelOverride,
      maxTokens: MAX_COMPLETION_TOKENS,
      silent: true,
    });
    if (!quick) return undefined;
    if (token.isCancellationRequested) return undefined;

    const userPrompt = [
      `Language: ${document.languageId}`,
      "Code before cursor:",
      "```",
      prefix,
      "```",
      "Code after cursor:",
      "```",
      suffix,
      "```",
    ].join("\n");

    let text: string;
    try {
      const completion = await quick.llm.complete({
        messages: buildMessages(SYSTEM_PROMPT, userPrompt),
        model: quick.model,
        maxTokens: quick.maxTokens,
        signal: tokenToAbortSignal(token),
      });
      text = completion.text;
    } catch {
      return undefined;
    }
    if (token.isCancellationRequested) return undefined;

    const cleaned = sanitizeCompletion(text, suffix);
    if (!cleaned.trim()) return undefined;

    return [new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position))];
  }
}

function tokenToAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  else token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

export function registerInlineCompletions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: "file" },
      new NinjaCodeInlineCompletionProvider(context),
    ),
  );
}
