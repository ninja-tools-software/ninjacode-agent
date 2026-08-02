import { CloseIcon, PinIcon } from "../icons.js";

function SessionTabRenameInput({
  title,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: {
  title: string;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
}) {
  return (
    <input
      autoFocus
      className="session-tab-rename"
      value={renameValue ?? title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onRenameChange?.(e.target.value)}
      onBlur={() => onRenameCancel?.()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onRenameCommit?.();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onRenameCancel?.();
        }
      }}
    />
  );
}

function SessionTabContent({
  title,
  pinned,
  onClose,
}: {
  title: string;
  pinned?: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {pinned && (
        <span className="session-tab-pin" aria-hidden="true">
          <PinIcon size={10} filled />
        </span>
      )}
      <span className="session-tab-label">{title}</span>
      <button
        type="button"
        className="session-tab-close"
        aria-label={`Close ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <CloseIcon size={12} />
      </button>
    </>
  );
}

export function SessionTab({
  title,
  active,
  pinned,
  renaming,
  renameValue,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onClose,
}: {
  title: string;
  active: boolean;
  pinned?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`session-tab${active ? " active" : ""}`}
      role="tab"
      aria-selected={active}
      onClick={() => {
        if (!renaming) onSelect();
      }}
    >
      {renaming ? (
        <SessionTabRenameInput
          title={title}
          renameValue={renameValue}
          onRenameChange={onRenameChange}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
        />
      ) : (
        <SessionTabContent title={title} pinned={pinned} onClose={onClose} />
      )}
    </div>
  );
}
