import { useCallback, useMemo, useRef } from "react";
import type { Ref } from "react";
import type { ContextRef, DropItem } from "../types.js";
import { useDropTarget, type DraggedSuggestion } from "../dnd/useDropTarget.js";
import { docLength, moveRef, type ComposerDoc } from "./model.js";
import { tokenAt, type ComposerToken } from "./token.js";
import { useComposerDropLocate } from "./composerDropLocate.js";
import { useComposerHandle, type ComposerHandle } from "./composerHandle.js";
import { createComposerKeyDownHandler } from "./composerKeyDown.js";
import { useComposerInputEvents } from "./composerInputEvents.js";
import { useComposerEditor } from "./useComposerEditor.js";

interface ComposerSetupProps {
  doc: ComposerDoc;
  onChange: (doc: ComposerDoc, caret: number) => void;
  disabled?: boolean;
  onMenuKeyDown?: (e: React.KeyboardEvent) => boolean;
  onToken: (token: ComposerToken | null) => void;
  onSubmit: () => void;
  onEscape: () => void;
  onDropItems: (items: DropItem[], offset: number) => void;
  onDropSuggestion: (suggestion: DraggedSuggestion, offset: number) => void;
  onOpenRef: (ref: ContextRef) => void;
  onPreviewRef?: (ref: ContextRef) => void;
}

export function useComposerSetup(
  ref: Ref<ComposerHandle>,
  {
    doc,
    onChange,
    disabled,
    onMenuKeyDown,
    onToken,
    onSubmit,
    onEscape,
    onDropItems,
    onDropSuggestion,
    onOpenRef,
    onPreviewRef,
  }: ComposerSetupProps,
) {
  const editor = useComposerEditor(doc, onChange);
  const docRef = useRef(doc);
  docRef.current = doc;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const notifyToken = useCallback(
    (next: ComposerDoc, caret: number) => onToken(tokenAt(next, caret)),
    [onToken],
  );

  useComposerHandle(ref, { editor, docRef, onToken });

  const locateDrop = useComposerDropLocate(editor, wrapRef);
  const drop = useDropTarget({
    locate: locateDrop,
    disabled,
    onDropItems,
    onDropSuggestion,
    onMoveRef: (refId, offset) => editor.apply(moveRef(docRef.current, refId, offset)),
  });

  const inputEvents = useComposerInputEvents({
    editor,
    docRef,
    notifyToken,
    onDropItems,
    onOpenRef,
    onPreviewRef,
  });

  const onKeyDown = useMemo(
    () => createComposerKeyDownHandler({ editor, docRef, onMenuKeyDown, onSubmit, onEscape }),
    [editor, onMenuKeyDown, onSubmit, onEscape],
  );

  const isEmpty = useMemo(() => docLength(doc) === 0, [doc]);

  return { editor, drop, inputEvents, onKeyDown, isEmpty, wrapRef };
}
