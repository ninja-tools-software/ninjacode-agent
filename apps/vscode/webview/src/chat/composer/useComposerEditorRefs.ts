import { useMemo, useRef } from "react";
import type { ContextRef } from "../types.js";
import type { ComposerEditorRefs } from "./composerEditorActions.js";
import { ComposerHistory } from "./history.js";
import type { ComposerDoc } from "./model.js";

export function useComposerEditorRefs(
  doc: ComposerDoc,
  onChange: (doc: ComposerDoc, caret: number) => void,
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const paintedRef = useRef<ComposerDoc>(doc);
  const pendingCaretRef = useRef<number | null>(null);
  const caretRef = useRef(0);
  const composingRef = useRef(false);
  const historyRef = useRef<ComposerHistory | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  if (historyRef.current === null) historyRef.current = new ComposerHistory({ doc, caret: 0 });

  const refsById = useMemo(() => {
    const map = new Map<string, ContextRef>();
    for (const node of doc.nodes) if (node.kind === "ref") map.set(node.ref.id, node.ref);
    return map;
  }, [doc]);
  const refsRef = useRef(refsById);
  refsRef.current = refsById;

  const refs = useMemo(
    (): ComposerEditorRefs => ({
      rootRef,
      paintedRef,
      pendingCaretRef,
      caretRef,
      composingRef,
      historyRef: historyRef as React.MutableRefObject<ComposerHistory>,
      refsRef,
      onChangeRef,
    }),
    [],
  );

  return { refs, rootRef, composingRef };
}
