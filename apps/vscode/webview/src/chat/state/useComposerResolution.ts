import { useCallback, useRef } from "react";
import type { ComposerHandle } from "../composer/Composer.js";
import { insertRefs, refsOf, updateRefs, type ComposerDoc } from "../composer/model.js";
import { refBadgeTitle } from "../composer/refBadgeView.js";
import type { DraggedSuggestion } from "../dnd/useDropTarget.js";
import { formatTokens, makeId } from "../format.js";
import type { ContextRef, DropItem, VsCodeApi } from "../types.js";
import type { PendingTarget } from "./useComposerResolution.types.js";
import { useComposerQueuePicks } from "./useComposerQueuePicks.js";

function useComposerPlacement(
  composerRef: React.RefObject<ComposerHandle | null>,
  docRef: React.RefObject<ComposerDoc>,
  setDocState: (doc: ComposerDoc) => void,
) {
  const pendingRef = useRef(new Map<string, PendingTarget>());

  const insertRefsAtOffset = useCallback(
    (incoming: ContextRef[], offset: number) => {
      if (incoming.length === 0) return;
      const edit = insertRefs(docRef.current, offset, incoming);
      setDocState(edit.doc);
      composerRef.current?.setDoc(edit.doc, edit.caret);
      composerRef.current?.focus(edit.caret);
    },
    [composerRef, docRef, setDocState],
  );

  const place = useCallback(
    (requestId: string, incoming: ContextRef[]) => {
      const target = pendingRef.current.get(requestId);
      pendingRef.current.delete(requestId);
      if (incoming.length === 0) return;

      const known = new Set(refsOf(docRef.current).map((r) => r.id));
      const updates = incoming.filter((r) => known.has(r.id));
      const additions = incoming.filter((r) => !known.has(r.id));
      if (updates.length > 0) {
        const next = updateRefs(docRef.current, updates);
        setDocState(next);
        composerRef.current?.setDoc(next);
      }
      if (additions.length === 0) return;
      if (target && typeof target.at === "number") insertRefsAtOffset(additions, target.at);
      else composerRef.current?.insertRefs(additions, (target?.at as "caret" | "end") ?? "caret");
    },
    [composerRef, docRef, insertRefsAtOffset, setDocState],
  );

  const queueAt = useCallback((at: PendingTarget) => {
    const requestId = makeId();
    pendingRef.current.set(requestId, at);
    return requestId;
  }, []);

  return { pendingRef, place, insertRefsAtOffset, queueAt };
}

function useComposerPreviews(vscode: VsCodeApi, composerRef: React.RefObject<ComposerHandle | null>) {
  const previewsRef = useRef(new Map<string, ContextRef>());

  const previewRef = useCallback(
    (ref: ContextRef) => {
      const requestId = makeId();
      previewsRef.current.set(requestId, ref);
      vscode.postMessage({ type: "ref_preview", requestId, ref });
    },
    [vscode],
  );

  const onRefPreview = useCallback(
    (requestId: string, preview: string, tokens?: number) => {
      const ref = previewsRef.current.get(requestId);
      previewsRef.current.delete(requestId);
      if (!ref || !preview.trim()) return;
      const header = tokens ? `${refBadgeTitle(ref)} · ${formatTokens(tokens)} tok` : refBadgeTitle(ref);
      composerRef.current?.setRefTooltip(ref.id, `${header}\n${preview}`);
    },
    [composerRef],
  );

  return { previewRef, onRefPreview };
}

export function useComposerResolution(
  vscode: VsCodeApi,
  composerRef: React.RefObject<ComposerHandle | null>,
  docRef: React.RefObject<ComposerDoc>,
  setDocState: (doc: ComposerDoc) => void,
) {
  const { pendingRef, place, queueAt } = useComposerPlacement(composerRef, docRef, setDocState);
  const { previewRef, onRefPreview } = useComposerPreviews(vscode, composerRef);

  const requestResolution = useCallback(
    (pending: ContextRef[]) => {
      if (pending.length === 0) return;
      const requestId = queueAt({ at: "caret" });
      vscode.postMessage({ type: "resolve_refs", requestId, refs: pending });
    },
    [queueAt, vscode],
  );

  const insertRefsAt = useCallback(
    (incoming: ContextRef[], at: "caret" | "end") => {
      if (incoming.length === 0) return;
      composerRef.current?.insertRefs(incoming, at);
      requestResolution(incoming.filter((r) => r.status === "pending"));
    },
    [composerRef, requestResolution],
  );

  const onDropItems = useCallback(
    (items: DropItem[], offset: number) => {
      if (items.length === 0) return;
      const requestId = queueAt({ at: offset });
      vscode.postMessage({ type: "resolve_drop", requestId, items });
    },
    [queueAt, vscode],
  );

  const onDropSuggestion = useCallback(
    (suggestion: DraggedSuggestion, offset: number) => {
      vscode.postMessage({
        type: "resolve_context_item",
        queryType: suggestion.queryType as import("../types.js").ContextQueryType,
        contextId: suggestion.id,
        contextLabel: suggestion.label,
        requestId: queueAt({ at: offset }),
      });
    },
    [queueAt, vscode],
  );

  const picks = useComposerQueuePicks(vscode, queueAt);

  return {
    pendingRef,
    requestResolution,
    insertRefsAt,
    place,
    onDropItems,
    onDropSuggestion,
    previewRef,
    onRefPreview,
    ...picks,
  };
}
