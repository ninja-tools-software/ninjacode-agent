import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "../../icons.js";
import { PICK_SUGGESTION_MIME } from "../dnd/useDropTarget.js";
import { animCls } from "../hooks/useAnimatedPresence.js";
import { CONTEXT_TYPES, type ContextQueryType, type ContextSuggestion } from "../types.js";
import { t as tr } from "../../i18n.js";

function ContextPickerTypeBar({
  queryType,
  onQueryType,
}: {
  queryType: ContextQueryType;
  onQueryType: (t: ContextQueryType) => void;
}) {
  return (
    <div className="context-picker-types">
      {CONTEXT_TYPES.map((ct) => (
        <button
          key={ct.id}
          className={`chip-btn ${queryType === ct.id ? "active" : ""}`}
          data-tooltip={tr("Search {0}", tr(ct.label).toLowerCase())}
          onClick={() => onQueryType(ct.id)}
        >
          {tr(ct.label)}
        </button>
      ))}
    </div>
  );
}

function ContextPickerResults({
  queryType,
  suggestions,
  highlight,
  onHighlight,
  onPick,
}: {
  queryType: ContextQueryType;
  suggestions: ContextSuggestion[];
  highlight: number;
  onHighlight: (i: number) => void;
  onPick: (item: ContextSuggestion) => void;
}) {
  return (
    <div className="context-picker-results" role="listbox">
      {suggestions.length === 0 && <div className="muted context-picker-empty">{tr("No matches")}</div>}
      {suggestions.map((s, i) => (
        <button
          key={s.id}
          role="option"
          aria-selected={i === highlight}
          className={`context-picker-item${i === highlight ? " highlighted" : ""}`}
          data-tooltip={s.detail ? `${s.label} — ${s.detail}` : s.label}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData(
              PICK_SUGGESTION_MIME,
              JSON.stringify({ queryType, id: s.id, label: s.label }),
            );
            e.dataTransfer.setData("text/plain", s.label);
          }}
          onMouseEnter={() => onHighlight(i)}
          onClick={() => onPick(s)}
        >
          <span className="context-picker-label">{s.label}</span>
          {s.detail && <span className="context-picker-detail">{s.detail}</span>}
        </button>
      ))}
    </div>
  );
}

function ContextPickerFooter({
  onAddSelection,
  onPickFiles,
  onClose,
}: {
  onAddSelection: () => void;
  onPickFiles: () => void;
  onClose: () => void;
}) {
  return (
    <div className="context-picker-footer">
      <button className="btn" data-tooltip="Attach the current editor selection" onClick={onAddSelection}>
        + Current selection
      </button>
      <button className="btn" data-tooltip="Pick files from disk" onClick={onPickFiles}>
        Browse files…
      </button>
      <button className="icon-btn" onClick={onClose} data-tooltip="Close" aria-label="Close">
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

function useContextPickerKeyboard(
  suggestions: ContextSuggestion[],
  highlight: number,
  onPick: (item: ContextSuggestion) => void,
  setHighlight: (i: number | ((prev: number) => number)) => void,
) {
  return (e: React.KeyboardEvent) => {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % suggestions.length);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i - 1 + suggestions.length) % suggestions.length);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = suggestions[highlight] ?? suggestions[0];
      if (item) onPick(item);
    }
  };
}

interface ContextPickerProps {
  queryType: ContextQueryType;
  query: string;
  suggestions: ContextSuggestion[];
  closing?: boolean;
  onQueryType: (t: ContextQueryType) => void;
  onQuery: (q: string) => void;
  onPick: (item: ContextSuggestion) => void;
  onAddSelection: () => void;
  onPickFiles: () => void;
  onClose: () => void;
}

/**
 * The `+` menu. Results can be clicked to attach at the caret, or dragged into
 * the composer to choose exactly where the badge lands.
 */
export function ContextPicker({
  queryType,
  query,
  suggestions,
  closing,
  onQueryType,
  onQuery,
  onPick,
  onAddSelection,
  onPickFiles,
  onClose,
}: ContextPickerProps) {
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onKeyDown = useContextPickerKeyboard(suggestions, highlight, onPick, setHighlight);

  useEffect(() => setHighlight(0), [suggestions, queryType]);
  useEffect(() => inputRef.current?.focus(), []);

  const typeLabel = CONTEXT_TYPES.find((t) => t.id === queryType)?.label.toLowerCase() ?? "context";

  return (
    <div
      className={animCls("context-picker anim-pop anim-pop-origin-bottom", closing && "anim-closing")}
      role="dialog"
      aria-label="Attach context"
    >
      <ContextPickerTypeBar queryType={queryType} onQueryType={onQueryType} />
      <input
        ref={inputRef}
        className="context-picker-search"
        value={query}
        placeholder={`Search ${typeLabel}…`}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <ContextPickerResults
        queryType={queryType}
        suggestions={suggestions}
        highlight={highlight}
        onHighlight={setHighlight}
        onPick={onPick}
      />
      <ContextPickerFooter onAddSelection={onAddSelection} onPickFiles={onPickFiles} onClose={onClose} />
    </div>
  );
}
