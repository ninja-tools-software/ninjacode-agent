import { useCallback } from "react";
import type { GhostCaret } from "../dnd/dropTargetTypes.js";
import { caretRect, offsetFromPoint } from "./dom.js";
import type { useComposerEditor } from "./useComposerEditor.js";

type ComposerEditor = ReturnType<typeof useComposerEditor>;

export function useComposerDropLocate(
  editor: ComposerEditor,
  wrapRef: React.RefObject<HTMLDivElement | null>,
) {
  return useCallback(
    (x: number, y: number): { offset: number; ghost: GhostCaret | null } => {
      const root = editor.rootRef.current;
      if (!root) return { offset: 0, ghost: null };
      const offset = offsetFromPoint(root, x, y);
      const rect = caretRect(root, offset);
      const origin = wrapRef.current?.getBoundingClientRect();
      if (!rect || !origin) return { offset, ghost: null };
      return {
        offset,
        ghost: { x: rect.left - origin.left, y: rect.top - origin.top, height: rect.height || 18 },
      };
    },
    [editor, wrapRef],
  );
}
