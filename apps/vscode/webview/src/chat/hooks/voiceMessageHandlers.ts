import type { MutableRefObject } from "react";
import type { ComposerDoc } from "../composer/model.js";
import { docLength, insertText } from "../composer/model.js";
import type { HostToWebview, VoiceState } from "../types.js";

type VoiceMessage = Extract<HostToWebview, { type: `voice_${string}` }>;

interface VoiceTranscriptDeps {
  baseRef: MutableRefObject<{ doc: ComposerDoc; caret: number } | null>;
  apply: (doc: ComposerDoc, caret: number) => void;
  reset: () => void;
}

export function handleVoiceTranscript(
  msg: Extract<VoiceMessage, { type: "voice_partial" | "voice_final" }>,
  deps: VoiceTranscriptDeps,
): void {
  const base = deps.baseRef.current;
  if (base && msg.text) {
    const needsSpace = base.caret > 0 && !/\s$/.test(textEndingAt(base.doc, base.caret));
    const edit = insertText(base.doc, base.caret, `${needsSpace ? " " : ""}${msg.text}`);
    deps.apply(edit.doc, edit.caret);
  }
  if (msg.type === "voice_final") {
    deps.baseRef.current = null;
    deps.reset();
  }
}

export function handleVoiceLevel(
  msg: Extract<VoiceMessage, { type: "voice_level" }>,
  stateRef: MutableRefObject<VoiceState>,
  setLevel: (level: number) => void,
): void {
  if (stateRef.current === "recording") setLevel(msg.level ?? 0);
}

export function handleVoiceError(
  msg: Extract<VoiceMessage, { type: "voice_error" }>,
  baseRef: MutableRefObject<{ doc: ComposerDoc; caret: number } | null>,
  reset: () => void,
  onError: (message: string) => void,
): void {
  baseRef.current = null;
  reset();
  onError(`Voice dictation: ${msg.text || "unknown error"}`);
}

export function handleVoiceSetupProgress(
  msg: Extract<VoiceMessage, { type: "voice_setup_progress" }>,
  setSetup: (label: string | null) => void,
): void {
  setSetup(msg.label ? (msg.percent != null ? `${msg.label} ${msg.percent}%` : msg.label) : null);
}

/** Last character before an offset, to decide whether to add a separating space. */
function textEndingAt(doc: ComposerDoc, caret: number): string {
  const at = Math.min(caret, docLength(doc));
  let seen = 0;
  let tail = "";
  for (const node of doc.nodes) {
    const len = node.kind === "text" ? node.text.length : 1;
    if (seen >= at) break;
    tail = node.kind === "text" ? node.text.slice(0, Math.min(len, at - seen)) : " ";
    seen += len;
  }
  return tail;
}
