import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerHandle } from "../composer/Composer.js";
import { EMPTY_DOC, type ComposerDoc } from "../composer/model.js";
import type { VsCodeApi } from "../types.js";
import { loadDrafts, readDraft, withDrafts, writeDraft } from "./drafts.js";

export function useComposerDrafts(vscode: VsCodeApi, activeSessionId: string | undefined) {
  const composerRef = useRef<ComposerHandle | null>(null);
  const [doc, setDocState] = useState<ComposerDoc>(EMPTY_DOC);
  const draftsRef = useRef(loadDrafts(vscode.getState?.() ?? null));
  const sessionRef = useRef(activeSessionId);
  const docRef = useRef(doc);
  docRef.current = doc;

  const setDoc = useCallback((next: ComposerDoc, _caret: number) => setDocState(next), []);

  useEffect(() => {
    if (sessionRef.current === activeSessionId) return;
    draftsRef.current = writeDraft(draftsRef.current, sessionRef.current, docRef.current);
    vscode.setState?.(withDrafts(vscode.getState?.() ?? null, draftsRef.current));
    sessionRef.current = activeSessionId;
    const restored = readDraft(draftsRef.current, activeSessionId);
    setDocState(restored);
    composerRef.current?.setDoc(restored);
  }, [activeSessionId, vscode]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      draftsRef.current = writeDraft(draftsRef.current, sessionRef.current, doc);
      vscode.setState?.(withDrafts(vscode.getState?.() ?? null, draftsRef.current));
    }, 400);
    return () => window.clearTimeout(id);
  }, [doc, vscode]);

  const clear = useCallback(() => {
    setDocState(EMPTY_DOC);
    composerRef.current?.setDoc(EMPTY_DOC);
    draftsRef.current = writeDraft(draftsRef.current, sessionRef.current, EMPTY_DOC);
    vscode.setState?.(withDrafts(vscode.getState?.() ?? null, draftsRef.current));
  }, [vscode]);

  return { composerRef, doc, docRef, setDoc, setDocState, clear, sessionRef, draftsRef };
}
