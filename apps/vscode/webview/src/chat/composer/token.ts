/** Detection of the `@mention` / `/command` token the caret is typing. */
import { textBeforeCaret, type ComposerDoc } from "./model.js";

export interface ComposerToken {
  trigger: "@" | "/";
  query: string;
  /** Characters to replace when the completion is accepted, trigger included. */
  length: number;
}

const TOKEN_RE = /(^|\s)([@/])([\w./\-#:]*)$/;

/**
 * The token ending at the caret, if any. `@` works anywhere in the sentence;
 * `/` only opens the command menu when it is the whole message so far, so a URL
 * path or a date doesn't trigger it.
 */
export function tokenAt(doc: ComposerDoc, caret: number): ComposerToken | null {
  const before = textBeforeCaret(doc, caret);
  const match = TOKEN_RE.exec(before);
  if (!match) return null;
  const trigger = match[2] as "@" | "/";
  const query = match[3] ?? "";
  if (trigger === "/" && caret !== query.length + 1) return null;
  return { trigger, query, length: query.length + 1 };
}
