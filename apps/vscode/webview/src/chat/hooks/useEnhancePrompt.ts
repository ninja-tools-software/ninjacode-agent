import { useCallback, useRef, useState } from "react";
import { docLength, docToText, normalize, refsOf, type ComposerDoc } from "../composer/model.js";
import { makeId } from "../format.js";
import type { Mode, VsCodeApi } from "../types.js";

interface UseEnhancePromptOptions {
  vscode: VsCodeApi;
  doc: ComposerDoc;
  mode: Mode;
  applyDoc: (doc: ComposerDoc, caret: number) => void;
  onError: (message: string) => void;
}

/** Request/response wiring for gateway prompt enhancement. */
export function useEnhancePrompt({
  vscode,
  doc,
  mode,
  applyDoc,
  onError,
}: UseEnhancePromptOptions) {
  const [enhancing, setEnhancing] = useState(false);
  const pendingRef = useRef<string | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const enhance = useCallback(() => {
    if (pendingRef.current) return;
    const text = docToText(docRef.current);
    if (!text) return;
    const requestId = makeId();
    pendingRef.current = requestId;
    setEnhancing(true);
    vscode.postMessage({ type: "enhance_prompt", requestId, text, mode });
  }, [mode, vscode]);

  const onResult = useCallback(
    (requestId: string, text: string) => {
      if (pendingRef.current !== requestId) return;
      pendingRef.current = null;
      setEnhancing(false);
      const refs = refsOf(docRef.current);
      const next = normalize({
        nodes: [
          ...refs.map((ref) => ({ kind: "ref" as const, ref })),
          ...(text ? [{ kind: "text" as const, text }] : []),
        ],
      });
      applyDoc(next, docLength(next));
    },
    [applyDoc],
  );

  const onEnhanceError = useCallback(
    (requestId: string, message: string) => {
      if (pendingRef.current !== requestId) return;
      pendingRef.current = null;
      setEnhancing(false);
      onError(message);
    },
    [onError],
  );

  return { enhancing, enhance, onResult, onEnhanceError };
}
