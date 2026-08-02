import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { GhostCaret } from "../dnd/dropTargetTypes.js";
import type { ComposerInputEvents } from "./composerInputEvents.js";
import type { useComposerEditor } from "./useComposerEditor.js";

type ComposerEditor = ReturnType<typeof useComposerEditor>;

interface ComposerInputAreaProps {
  editor: ComposerEditor;
  placeholder: string;
  disabled?: boolean;
  isEmpty: boolean;
  dropGhost: GhostCaret | null;
  wrapRef: React.RefObject<HTMLDivElement | null>;
  inputEvents: ComposerInputEvents;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocusChange: (focused: boolean) => void;
}

export function ComposerInputArea({
  editor,
  placeholder,
  disabled,
  isEmpty,
  dropGhost,
  wrapRef,
  inputEvents,
  onKeyDown,
  onFocusChange,
}: ComposerInputAreaProps) {
  return (
    <div className="composer-input-wrap" ref={wrapRef}>
      <div
        ref={editor.rootRef}
        className="composer-input"
        contentEditable={disabled ? false : "plaintext-only"}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        spellCheck
        data-placeholder={placeholder}
        onInput={inputEvents.onInput}
        onKeyDown={onKeyDown}
        onPaste={inputEvents.onPaste}
        onDragStart={inputEvents.onDragStart}
        onClick={inputEvents.onClick}
        onMouseOver={inputEvents.onMouseOver}
        onCompositionStart={editor.onCompositionStart}
        onCompositionEnd={editor.onCompositionEnd}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
      {isEmpty && (
        <div className="composer-placeholder" aria-hidden="true">
          {placeholder}
        </div>
      )}
      {dropGhost && (
        <div
          className="composer-drop-caret"
          aria-hidden="true"
          style={{ left: dropGhost.x, top: dropGhost.y, height: dropGhost.height }}
        />
      )}
    </div>
  );
}
