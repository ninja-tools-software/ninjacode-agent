import { useImperativeHandle } from "react";
import type { MutableRefObject, Ref } from "react";
import type { ContextRef } from "../types.js";
import { readDoc, setBadgeTooltip } from "./dom.js";
import {
  docLength,
  insertRefs,
  insertText,
  replaceTokenBeforeCaret,
  replaceTokenWithRefs,
  type ComposerDoc,
} from "./model.js";
import type { ComposerToken } from "./token.js";
import type { useComposerEditor } from "./useComposerEditor.js";

export interface ComposerHandle {
  insertRefs: (refs: readonly ContextRef[], at?: "caret" | "end") => void;
  insertText: (text: string) => void;
  replaceToken: (token: ComposerToken, text: string) => void;
  replaceTokenWithRefs: (token: ComposerToken, refs: readonly ContextRef[]) => void;
  hasContent: () => boolean;
  setDoc: (doc: ComposerDoc, caret?: number) => void;
  focus: (caret?: number) => void;
  caret: () => number;
  setRefTooltip: (refId: string, tooltip: string) => void;
}

type ComposerEditor = ReturnType<typeof useComposerEditor>;

interface ComposerHandleDeps {
  editor: ComposerEditor;
  docRef: MutableRefObject<ComposerDoc>;
  onToken: (token: ComposerToken | null) => void;
}

export function useComposerHandle(
  ref: Ref<ComposerHandle>,
  { editor, docRef, onToken }: ComposerHandleDeps,
): void {
  useImperativeHandle(
    ref,
    (): ComposerHandle => ({
      insertRefs: (refs, at = "caret") => {
        const current = docRef.current;
        const offset = at === "end" ? docLength(current) : editor.caret();
        editor.apply(insertRefs(current, offset, refs));
        editor.focus();
        onToken(null);
      },
      insertText: (text) => {
        editor.apply(insertText(docRef.current, editor.caret(), text));
        editor.focus();
      },
      replaceToken: (token, text) => {
        const edit = replaceTokenBeforeCaret(docRef.current, editor.caret(), token.length, text);
        editor.apply(edit);
        editor.focus();
        onToken(null);
      },
      replaceTokenWithRefs: (token, refs) => {
        const edit = replaceTokenWithRefs(docRef.current, editor.caret(), token.length, refs);
        editor.apply(edit);
        editor.focus();
        onToken(null);
      },
      setDoc: (next, caret) => {
        editor.reset(next, caret);
        onToken(null);
      },
      hasContent: () => {
        const root = editor.rootRef.current;
        const current = docRef.current;
        if (!root) return docLength(current) > 0;
        const refs = new Map<string, ContextRef>();
        for (const node of current.nodes) {
          if (node.kind === "ref") refs.set(node.ref.id, node.ref);
        }
        return docLength(readDoc(root, refs)) > 0;
      },
      focus: (caret) => editor.focus(caret),
      caret: () => editor.caret(),
      setRefTooltip: (refId, tooltip) => {
        const root = editor.rootRef.current;
        if (root) setBadgeTooltip(root, refId, tooltip);
      },
    }),
    [editor, docRef, onToken],
  );
}
