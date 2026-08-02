import { CloseIcon } from "../../icons.js";
import type { ContextRef } from "../types.js";
import { refBadgeClass, refBadgeLabel, refBadgeTitle, refIconPaths } from "./refBadgeView.js";

function RefIcon({ kind, size = 11 }: { kind: ContextRef["kind"]; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {refIconPaths(kind).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

/**
 * Read-only badge, used outside the composer (history messages, drag preview).
 * The composer builds its own DOM node so React never touches the contenteditable.
 */
export function RefBadge({
  refItem,
  onOpen,
  onRemove,
}: {
  refItem: ContextRef;
  onOpen?: (ref: ContextRef) => void;
  onRemove?: (ref: ContextRef) => void;
}) {
  return (
    <span className={refBadgeClass(refItem, onOpen && "ref-badge-clickable")} data-tooltip={refBadgeTitle(refItem)}>
      <span className="ref-badge-icon">
        <RefIcon kind={refItem.kind} />
      </span>
      <span
        className="ref-badge-label"
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={onOpen ? () => onOpen(refItem) : undefined}
        onKeyDown={
          onOpen
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(refItem);
                }
              }
            : undefined
        }
      >
        {refBadgeLabel(refItem)}
      </span>
      {onRemove && (
        <button
          type="button"
          className="ref-badge-remove"
          aria-label={`Remove ${refItem.label}`}
          onClick={() => onRemove(refItem)}
        >
          <CloseIcon size={10} />
        </button>
      )}
    </span>
  );
}
