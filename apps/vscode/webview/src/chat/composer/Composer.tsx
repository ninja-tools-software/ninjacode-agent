/**
 * The chat input: a contenteditable that mixes typed text with atomic context
 * badges. React owns the chrome (placeholder, drop overlay, ghost caret) but
 * never the editable children — see `useComposerEditor` for why.
 */
import { forwardRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ContextRef, DropItem, Mode } from "../types.js";
import type { DraggedSuggestion } from "../dnd/useDropTarget.js";
import type { ComposerDoc } from "./model.js";
import type { ComposerToken } from "./token.js";
import { ComposerInputArea } from "./ComposerInputArea.js";
import type { ComposerHandle } from "./composerHandle.js";
import { useComposerSetup } from "./useComposerSetup.js";

export type { ComposerHandle };

interface ComposerProps {
  doc: ComposerDoc;
  onChange: (doc: ComposerDoc, caret: number) => void;
  placeholder: string;
  mode: Mode;
  disabled?: boolean;
  onMenuKeyDown?: (e: ReactKeyboardEvent) => boolean;
  onToken: (token: ComposerToken | null) => void;
  onSubmit: () => void;
  onEscape: () => void;
  onDropItems: (items: DropItem[], offset: number) => void;
  onDropSuggestion: (suggestion: DraggedSuggestion, offset: number) => void;
  onOpenRef: (ref: ContextRef) => void;
  onPreviewRef?: (ref: ContextRef) => void;
  onFocusChange: (focused: boolean) => void;
  children?: ReactNode;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { placeholder, disabled, onFocusChange, mode, children, ...setupProps },
  ref,
) {
  const { editor, drop, inputEvents, onKeyDown, isEmpty, wrapRef } = useComposerSetup(ref, setupProps);

  return (
    <div
      className={`composer-card mode-${mode}${drop.active ? " composer-dropping" : ""}`}
      {...drop.handlers}
    >
      <ComposerInputArea
        editor={editor}
        placeholder={placeholder}
        disabled={disabled}
        isEmpty={isEmpty}
        dropGhost={drop.ghost}
        wrapRef={wrapRef}
        inputEvents={inputEvents}
        onKeyDown={onKeyDown}
        onFocusChange={onFocusChange}
      />
      {drop.active && (
        <div className="composer-drop-overlay" aria-hidden="true">
          <span className="composer-drop-label">{drop.label}</span>
        </div>
      )}
      {children}
    </div>
  );
});
