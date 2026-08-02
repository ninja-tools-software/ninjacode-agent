import { useEffect, useState } from "react";
import { ShurikenMark } from "./ui/Brand.js";
import { t } from "../i18n.js";

const SUGGESTION_KEYS = [
  "Explain this codebase",
  "Fix the failing tests",
  "Add a feature with a plan first",
];

function SuggestionConfirmDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="suggestion-confirm" role="alertdialog" aria-labelledby="suggestion-confirm-title">
      <p id="suggestion-confirm-title">{t("Replace your current message with this suggestion?")}</p>
      <div className="suggestion-confirm-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="btn primary" onClick={onConfirm}>
          {t("Replace")}
        </button>
      </div>
    </div>
  );
}

function SuggestionList({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="suggestions">
      {SUGGESTION_KEYS.map((key) => {
        const label = t(key);
        return (
          <button
            key={key}
            type="button"
            className="suggestion"
            data-tooltip={t("Use suggestion: {0}", label)}
            onClick={() => onPick(label)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function useSuggestionConfirmDismiss(pending: string | null, onDismiss: () => void) {
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onDismiss]);
}

export function EmptyState({
  getHasContent,
  onPick,
}: {
  getHasContent: () => boolean;
  onPick: (text: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);

  useSuggestionConfirmDismiss(pending, () => setPending(null));

  const pick = (text: string) => {
    if (getHasContent()) {
      setPending(text);
      return;
    }
    onPick(text);
  };

  const confirmPending = () => {
    if (!pending) return;
    onPick(pending);
    setPending(null);
  };

  return (
    <div className="empty-state panel-enter">
      <div className="empty-logo">
        <ShurikenMark id="empty" size={32} />
      </div>
      <h2>{t("Ready when you are")}</h2>
      <p>{t("Describe a coding task, or start from a suggestion.")}</p>
      <SuggestionList onPick={pick} />
      {pending && (
        <SuggestionConfirmDialog onCancel={() => setPending(null)} onConfirm={confirmPending} />
      )}
      <p className="empty-hint muted">
        {t(
          "Drag files, folders or tabs straight into the message box — hold Shift when dragging from the Explorer.",
        )}
      </p>
    </div>
  );
}
