import type { MutableRefObject } from "react";
import type { ContextRef } from "../types.js";
import { getCaret, readDoc, renderDoc, setCaret } from "./dom.js";
import { ComposerHistory, type HistoryEntry } from "./history.js";
import {
  clampOffset,
  docEquals,
  docLength,
  type ComposerDoc,
  type EditResult,
} from "./model.js";

export interface ComposerEditorRefs {
  rootRef: MutableRefObject<HTMLDivElement | null>;
  paintedRef: MutableRefObject<ComposerDoc>;
  pendingCaretRef: MutableRefObject<number | null>;
  caretRef: MutableRefObject<number>;
  composingRef: MutableRefObject<boolean>;
  historyRef: MutableRefObject<ComposerHistory>;
  refsRef: MutableRefObject<Map<string, ContextRef>>;
  onChangeRef: MutableRefObject<(doc: ComposerDoc, caret: number) => void>;
}

export function readComposerCaret(refs: ComposerEditorRefs): number {
  const root = refs.rootRef.current;
  if (!root) return refs.caretRef.current;
  const sel = getCaret(root);
  if (sel) refs.caretRef.current = sel.focus;
  return refs.caretRef.current;
}

function commitComposerEdit(
  refs: ComposerEditorRefs,
  next: ComposerDoc,
  caret: number,
  options?: { coalesce?: boolean; repaint?: boolean },
): void {
  const clamped = clampOffset(next, caret);
  refs.caretRef.current = clamped;
  refs.historyRef.current.push({ doc: next, caret: clamped }, options?.coalesce ?? false);
  if (options?.repaint !== false) refs.pendingCaretRef.current = clamped;
  refs.onChangeRef.current(next, clamped);
}

export function applyComposerEdit(
  refs: ComposerEditorRefs,
  edit: EditResult,
  options?: { coalesce?: boolean },
): void {
  commitComposerEdit(refs, edit.doc, edit.caret, options);
}

export function resetComposerDoc(
  refs: ComposerEditorRefs,
  next: ComposerDoc,
  caret?: number,
): void {
  const at = caret ?? docLength(next);
  refs.caretRef.current = at;
  refs.historyRef.current.reset({ doc: next, caret: at });
  refs.pendingCaretRef.current = at;
  refs.onChangeRef.current(next, at);
}

export function syncComposerFromDom(refs: ComposerEditorRefs): void {
  const root = refs.rootRef.current;
  if (!root || refs.composingRef.current) return;
  const next = readDoc(root, refs.refsRef.current);
  refs.paintedRef.current = next;
  const caret = getCaret(root)?.focus ?? docLength(next);
  refs.caretRef.current = caret;
  refs.historyRef.current.push({ doc: next, caret }, true);
  refs.onChangeRef.current(next, caret);
}

export function restoreComposerHistory(
  refs: ComposerEditorRefs,
  entry: HistoryEntry | null,
): void {
  if (!entry) return;
  refs.caretRef.current = entry.caret;
  refs.pendingCaretRef.current = entry.caret;
  refs.onChangeRef.current(entry.doc, entry.caret);
}

export function focusComposerEditor(refs: ComposerEditorRefs, caret?: number): void {
  const root = refs.rootRef.current;
  if (!root) return;
  root.focus();
  const at = caret ?? refs.caretRef.current;
  setCaret(root, clampOffset(refs.paintedRef.current, at));
  refs.caretRef.current = at;
}

export function repaintComposerIfNeeded(refs: ComposerEditorRefs, doc: ComposerDoc): void {
  const root = refs.rootRef.current;
  if (!root) return;
  if (docEquals(refs.paintedRef.current, doc) && refs.pendingCaretRef.current === null) {
    refs.paintedRef.current = doc;
    return;
  }
  renderDoc(root, doc);
  refs.paintedRef.current = doc;
  const caret = refs.pendingCaretRef.current;
  refs.pendingCaretRef.current = null;
  if (caret !== null && document.activeElement === root) {
    setCaret(root, clampOffset(doc, caret));
    refs.caretRef.current = clampOffset(doc, caret);
  }
}
