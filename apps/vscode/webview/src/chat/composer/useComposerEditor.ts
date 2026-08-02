/**
 * Drives the contenteditable: keeps the DOM in sync with the document, owns the
 * caret and the undo stack, and exposes edits as pure `EditResult`s.
 */
import type { ComposerDoc, EditResult } from "./model.js";
import { useComposerEditorApi } from "./useComposerEditorApi.js";
import { useComposerEditorRefs } from "./useComposerEditorRefs.js";
import { useComposerRepaint } from "./useComposerRepaint.js";

interface ComposerEditor {
  rootRef: React.RefObject<HTMLDivElement | null>;
  apply: (edit: EditResult, options?: { coalesce?: boolean }) => void;
  reset: (doc: ComposerDoc, caret?: number) => void;
  caret: () => number;
  selection: () => { anchor: number; focus: number } | null;
  focus: (caret?: number) => void;
  undo: () => void;
  redo: () => void;
  isComposing: () => boolean;
  syncFromDom: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}

export function useComposerEditor(
  doc: ComposerDoc,
  onChange: (doc: ComposerDoc, caret: number) => void,
): ComposerEditor {
  const { refs, rootRef, composingRef } = useComposerEditorRefs(doc, onChange);
  useComposerRepaint(refs, doc);
  return useComposerEditorApi(refs, rootRef, composingRef);
}
