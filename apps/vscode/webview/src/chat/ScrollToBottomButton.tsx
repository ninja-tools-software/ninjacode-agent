interface ScrollToBottomButtonProps {
  visible: boolean;
  hasNewContent: boolean;
  onClick: () => void;
}

export function ScrollToBottomButton({ visible, hasNewContent, onClick }: ScrollToBottomButtonProps) {
  if (!visible) return null;
  return (
    <div className="scroll-bottom-overlay">
      <button
        type="button"
        className="scroll-bottom-btn"
        onClick={onClick}
        aria-label="Scroll to bottom"
        data-tooltip="Scroll to bottom"
      >
        <span className="scroll-bottom-btn__icon" aria-hidden="true">
          ↓
        </span>
        {hasNewContent && <span className="scroll-bottom-btn__dot" aria-hidden="true" />}
      </button>
    </div>
  );
}
