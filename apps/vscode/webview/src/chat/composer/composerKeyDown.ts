import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { deleteBackward, deleteForward, locate, type ComposerDoc } from "./model.js";
import type { useComposerEditor } from "./useComposerEditor.js";

type ComposerEditor = ReturnType<typeof useComposerEditor>;

interface ComposerKeyDownDeps {
  editor: ComposerEditor;
  docRef: React.MutableRefObject<ComposerDoc>;
  onMenuKeyDown?: (e: ReactKeyboardEvent) => boolean;
  onSubmit: () => void;
  onEscape: () => void;
}

export function createComposerKeyDownHandler(deps: ComposerKeyDownDeps) {
  return (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (deps.onMenuKeyDown?.(e)) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) deps.editor.redo();
      else deps.editor.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      deps.editor.redo();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      deps.onEscape();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !deps.editor.isComposing()) {
      e.preventDefault();
      deps.onSubmit();
      return;
    }
    handleBadgeDeleteKey(e, deps);
  };
}

/** Badges are atomic: delete them as a unit instead of leaving a half-selected element. */
function handleBadgeDeleteKey(
  e: ReactKeyboardEvent<HTMLDivElement>,
  { editor, docRef }: ComposerKeyDownDeps,
): void {
  if (e.key !== "Backspace" && e.key !== "Delete") return;
  const selection = editor.selection();
  if (!selection || selection.anchor !== selection.focus) return;
  const current = docRef.current;
  const at = selection.focus;
  const index = e.key === "Backspace" ? locate(current, at - 1).index : locate(current, at).index;
  if (current.nodes[index]?.kind !== "ref") return;
  e.preventDefault();
  const edit = e.key === "Backspace" ? deleteBackward(current, at) : deleteForward(current, at);
  editor.apply(edit);
}
