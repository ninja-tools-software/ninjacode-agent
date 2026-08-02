import type { MutableRefObject } from "react";
import type { ComposerDoc } from "../composer/model.js";
import type { VoiceState, VsCodeApi } from "../types.js";

interface VoiceSessionRefs {
  stateRef: MutableRefObject<VoiceState>;
  baseRef: MutableRefObject<{ doc: ComposerDoc; caret: number } | null>;
}

interface VoiceSessionActions {
  setState: (state: VoiceState) => void;
  setLevel: (level: number) => void;
}

interface StartVoiceSessionInput {
  doc: ComposerDoc;
  caret: number;
  refs: VoiceSessionRefs;
  vscode: VsCodeApi;
  actions: VoiceSessionActions;
}

interface FinishVoiceSessionInput {
  refs: VoiceSessionRefs;
  vscode: VsCodeApi;
  actions: VoiceSessionActions;
}

export function startVoiceSession({
  doc,
  caret,
  refs,
  vscode,
  actions,
}: StartVoiceSessionInput): void {
  if (refs.stateRef.current !== "idle") return;
  refs.baseRef.current = { doc, caret };
  actions.setState("recording");
  actions.setLevel(0);
  vscode.postMessage({ type: "voice_start" });
}

export function finishVoiceSession({ refs, vscode, actions }: FinishVoiceSessionInput): void {
  if (refs.stateRef.current !== "recording") return;
  actions.setState("transcribing");
  actions.setLevel(0);
  vscode.postMessage({ type: "voice_stop" });
}

export function cancelVoiceSession(
  refs: VoiceSessionRefs,
  vscode: VsCodeApi,
  apply: (doc: ComposerDoc, caret: number) => void,
  reset: () => void,
): void {
  if (refs.stateRef.current === "idle") return;
  reset();
  const base = refs.baseRef.current;
  if (base) apply(base.doc, base.caret);
  vscode.postMessage({ type: "voice_cancel" });
}
