import { useCallback } from "react";
import {
  applyComposerEdit,
  focusComposerEditor,
  readComposerCaret,
  resetComposerDoc,
  restoreComposerHistory,
  syncComposerFromDom,
  type ComposerEditorRefs,
} from "./composerEditorActions.js";
import { getCaret } from "./dom.js";
import type { ComposerDoc, EditResult } from "./model.js";

interface ComposerEditorApi {
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

export function useComposerEditorApi(
  refs: ComposerEditorRefs,
  rootRef: React.RefObject<HTMLDivElement | null>,
  composingRef: React.MutableRefObject<boolean>,
): ComposerEditorApi {
  const apply = useCallback(
    (edit: EditResult, options?: { coalesce?: boolean }) => applyComposerEdit(refs, edit, options),
    [refs],
  );

  const reset = useCallback(
    (next: ComposerDoc, caret?: number) => resetComposerDoc(refs, next, caret),
    [refs],
  );

  const syncFromDom = useCallback(() => syncComposerFromDom(refs), [refs]);
  const focus = useCallback((caret?: number) => focusComposerEditor(refs, caret), [refs]);
  const readCaret = useCallback(() => readComposerCaret(refs), [refs]);

  return {
    rootRef,
    apply,
    reset,
    caret: readCaret,
    selection: () => (rootRef.current ? getCaret(rootRef.current) : null),
    focus,
    undo: () => restoreComposerHistory(refs, refs.historyRef.current.undo()),
    redo: () => restoreComposerHistory(refs, refs.historyRef.current.redo()),
    isComposing: () => composingRef.current,
    syncFromDom,
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
      syncComposerFromDom(refs);
    },
  };
}
