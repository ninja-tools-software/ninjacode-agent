import { animCls } from "../hooks/useAnimatedPresence.js";

export interface AutocompleteItem {
  id: string;
  label: string;
  detail?: string;
}

/**
 * The inline list shown above the composer while typing `@` or `/`. Keyboard
 * navigation lives in the composer (the caret must stay in the editor), so this
 * only renders and reports clicks.
 */
export function AutocompleteMenu({
  items,
  activeIndex,
  className,
  closing,
  emptyLabel,
  onHover,
  onPick,
}: {
  items: AutocompleteItem[];
  activeIndex: number;
  className: string;
  closing?: boolean;
  emptyLabel?: string;
  onHover: (index: number) => void;
  onPick: (item: AutocompleteItem, index: number) => void;
}) {
  return (
    <div
      className={animCls(className, "anim-pop anim-pop-origin-bottom", closing && "anim-closing")}
      role="listbox"
    >
      {items.length === 0 && emptyLabel && <div className="muted context-picker-empty">{emptyLabel}</div>}
      {items.map((item, i) => (
        <button
          key={item.id}
          role="option"
          aria-selected={i === activeIndex}
          className={`slash-item${i === activeIndex ? " active" : ""}`}
          data-tooltip={item.detail ?? item.label}
          onMouseEnter={() => onHover(i)}
          // The composer must keep focus: a blur would collapse the caret.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item, i)}
        >
          <span className="slash-name">{item.label}</span>
          {item.detail && <span className="slash-desc">{item.detail}</span>}
        </button>
      ))}
    </div>
  );
}
