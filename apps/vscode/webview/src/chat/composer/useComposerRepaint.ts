import { useEffect } from "react";
import type { ComposerEditorRefs } from "./composerEditorActions.js";
import { repaintComposerIfNeeded } from "./composerEditorActions.js";
import type { ComposerDoc } from "./model.js";

export function useComposerRepaint(
  refs: ComposerEditorRefs,
  doc: ComposerDoc,
): void {
  useEffect(() => {
    repaintComposerIfNeeded(refs, doc);
  }, [refs, doc]);
}
