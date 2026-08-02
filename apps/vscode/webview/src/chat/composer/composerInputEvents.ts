import { useCallback, useRef } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { INTERNAL_REF_MIME } from "../dnd/dropTargetTypes.js";
import type { ContextRef, DropItem } from "../types.js";
import { badgeIdFromEvent } from "./dom.js";
import { createComposerPasteHandler } from "./composerPaste.js";
import type { ComposerDoc } from "./model.js";
import type { useComposerEditor } from "./useComposerEditor.js";

type ComposerEditor = ReturnType<typeof useComposerEditor>;

interface ComposerInputEventDeps {
  editor: ComposerEditor;
  docRef: React.MutableRefObject<ComposerDoc>;
  notifyToken: (next: ComposerDoc, caret: number) => void;
  onDropItems: (items: DropItem[], offset: number) => void;
  onOpenRef: (ref: ContextRef) => void;
  onPreviewRef?: (ref: ContextRef) => void;
}

export function useComposerInputEvents(deps: ComposerInputEventDeps) {
  const previewed = useRef(new Set<string>());

  const onInput = useCallback(() => {
    deps.editor.syncFromDom();
    deps.notifyToken(deps.docRef.current, deps.editor.caret());
  }, [deps]);

  const onPaste = useCallback(createComposerPasteHandler(deps), [deps]);

  const onDragStart = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const id = badgeIdFromEvent(e.target);
    if (!id) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(INTERNAL_REF_MIME, id);
    e.dataTransfer.setData("text/plain", "");
  }, []);

  const onClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const id = badgeIdFromEvent(e.target);
      if (!id) return;
      const node = deps.docRef.current.nodes.find((n) => n.kind === "ref" && n.ref.id === id);
      if (node?.kind === "ref") deps.onOpenRef(node.ref);
    },
    [deps],
  );

  const onMouseOver = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!deps.onPreviewRef) return;
      const id = badgeIdFromEvent(e.target);
      if (!id || previewed.current.has(id)) return;
      const node = deps.docRef.current.nodes.find((n) => n.kind === "ref" && n.ref.id === id);
      if (node?.kind !== "ref" || node.ref.status !== "resolved") return;
      previewed.current.add(id);
      deps.onPreviewRef(node.ref);
    },
    [deps],
  );

  return { onInput, onPaste, onDragStart, onClick, onMouseOver };
}

export type ComposerInputEvents = ReturnType<typeof useComposerInputEvents>;
