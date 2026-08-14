import { useState, type ReactNode } from "react";
import { CopyIcon, EditIcon, ForkIcon } from "../../icons.js";
import { t } from "../../i18n.js";
import { RefBadge } from "../composer/RefBadge.jsx";
import type { ContextRef, VsCodeApi } from "../types.js";

/**
 * Re-render the badges the user authored inside their sentence. The host stores
 * the message as plain text with `@mentions`, so each ref is matched back to the
 * first occurrence of its mention and swapped for a badge.
 */
export function renderWithRefs(text: string, refs: readonly ContextRef[]): ReactNode[] {
  if (refs.length === 0) return [text];

  const mentions = refs
    .map((ref) => ({ ref, mention: mentionOf(ref) }))
    .filter((m) => m.mention.length > 0)
    .sort((a, b) => b.mention.length - a.mention.length);

  const out: ReactNode[] = [];
  let rest = text;
  let guard = 0;
  while (rest.length > 0 && guard++ < 500) {
    let best: { index: number; ref: ContextRef; mention: string } | null = null;
    for (const { ref, mention } of mentions) {
      const index = rest.indexOf(mention);
      if (index === -1) continue;
      if (!best || index < best.index) best = { index, ref, mention };
    }
    if (!best) break;
    if (best.index > 0) out.push(rest.slice(0, best.index));
    out.push(<RefBadge key={`${best.ref.id}-${out.length}`} refItem={best.ref} />);
    rest = rest.slice(best.index + best.mention.length);
  }
  if (rest) out.push(rest);
  return out;
}

/** Mirrors `refMention` on the host, which produced the text we're parsing. */
function mentionOf(ref: ContextRef): string {
  switch (ref.kind) {
    case "url":
      return ref.target;
    case "diagnostics":
      return `@${ref.target} (problems)`;
    case "scm_diff":
      return ref.label;
    case "image":
      return `[image: ${ref.label}]`;
    case "terminal":
      return `[terminal: ${ref.label}]`;
    case "selection":
    case "snippet":
      return `@${ref.label}`;
    default:
      return `@${ref.target}`;
  }
}

export function UserMessage({
  text,
  refs,
  canEditFork,
  onEdit,
  onFork,
  vscode,
}: {
  text: string;
  refs?: ContextRef[];
  canEditFork: boolean;
  onEdit: () => void;
  onFork: () => void;
  vscode: VsCodeApi;
}) {
  return (
    <div className="msg user user-hoverable msg-enter">
      <span className="msg-user-text">{renderWithRefs(text, refs ?? [])}</span>
      <div className="msg-hover-actions">
        <button
          className="icon-btn icon-btn--sm"
          data-tooltip={t("Copy message")}
          aria-label={t("Copy message")}
          onClick={() => vscode.postMessage({ type: "copy_to_clipboard", text })}
        >
          <CopyIcon size={12} />
        </button>
        {canEditFork && (
          <>
            <button
              className="icon-btn icon-btn--sm"
              data-tooltip={t("Edit this message and resend")}
              aria-label={t("Edit this message and resend")}
              onClick={onEdit}
            >
              <EditIcon size={12} />
            </button>
            <button
              className="icon-btn icon-btn--sm"
              data-tooltip={t("Fork the conversation from here")}
              aria-label={t("Fork the conversation from here")}
              onClick={onFork}
            >
              <ForkIcon size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function UserMessageEditor({
  initialText,
  onCancel,
  onSave,
}: {
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initialText);
  return (
    <div className="msg user editing msg-enter">
      <textarea
        autoFocus
        className="msg-edit-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="msg-edit-actions">
        <button
          className="btn primary"
          data-tooltip={t("Save edits and resend this message")}
          disabled={!text.trim()}
          onClick={() => onSave(text.trim())}
        >
          {t("Save & resend")}
        </button>
        <button className="btn" data-tooltip={t("Cancel editing this message")} onClick={onCancel}>
          {t("Cancel")}
        </button>
      </div>
    </div>
  );
}
