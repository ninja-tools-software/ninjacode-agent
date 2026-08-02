import type { RefObject } from "react";
import { docFromText } from "./composer/model.js";
import type { ComposerHandle } from "./composer/Composer.js";
import { EmptyState } from "./EmptyState.js";

interface LogEmptyStateProps {
  composerRef: RefObject<ComposerHandle | null>;
  hasContent: boolean;
  setDoc: (doc: ReturnType<typeof docFromText>, caret: number) => void;
}

function LogEmptyState({ composerRef, hasContent, setDoc }: LogEmptyStateProps) {
  return (
    <EmptyState
      getHasContent={() => composerRef.current?.hasContent() ?? hasContent}
      onPick={(text) => {
        const next = docFromText(text);
        setDoc(next, text.length);
        composerRef.current?.setDoc(next, text.length);
        composerRef.current?.focus(text.length);
      }}
    />
  );
}

export { LogEmptyState };
