/**
 * Voice dictation state.
 *
 * Capture runs in the extension host — webviews are sandboxed iframes and cannot
 * call `getUserMedia` — so this only drives the UI and relays start/stop/cancel.
 * Partial transcripts are re-applied from the snapshot taken when dictation
 * started, so a correction from the recognizer replaces text instead of stacking.
 */
import { useCallback, useRef, useState } from "react";
import type { ComposerDoc } from "../composer/model.js";
import type { HostToWebview, VoiceState, VsCodeApi } from "../types.js";
import {
  handleVoiceError,
  handleVoiceLevel,
  handleVoiceSetupProgress,
  handleVoiceTranscript,
} from "./voiceMessageHandlers.js";
import {
  cancelVoiceSession,
  finishVoiceSession,
  startVoiceSession,
} from "./voiceSessionControls.js";

type VoiceMessage = Extract<HostToWebview, { type: `voice_${string}` }>;

interface Voice {
  state: VoiceState;
  level: number;
  /** Model download / warm-up progress, shown in the button tooltip. */
  setup: string | null;
  start: (doc: ComposerDoc, caret: number) => void;
  finish: () => void;
  cancel: () => void;
  handleMessage: (msg: VoiceMessage) => void;
}

export function useVoice(
  vscode: VsCodeApi,
  apply: (doc: ComposerDoc, caret: number) => void,
  onError: (message: string) => void,
): Voice {
  const [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0);
  const [setup, setSetup] = useState<string | null>(null);
  const stateRef = useRef<VoiceState>("idle");
  stateRef.current = state;
  const baseRef = useRef<{ doc: ComposerDoc; caret: number } | null>(null);
  const sessionRefs = { stateRef, baseRef };

  const reset = useCallback(() => {
    setState("idle");
    setLevel(0);
    setSetup(null);
  }, []);

  const start = useCallback(
    (doc: ComposerDoc, caret: number) => {
      startVoiceSession({ doc, caret, refs: sessionRefs, vscode, actions: { setState, setLevel } });
    },
    [vscode],
  );

  const finish = useCallback(() => {
    finishVoiceSession({ refs: sessionRefs, vscode, actions: { setState, setLevel } });
  }, [vscode]);

  const cancel = useCallback(() => {
    cancelVoiceSession(sessionRefs, vscode, apply, reset);
  }, [apply, reset, vscode]);

  const handleMessage = useCallback(
    (msg: VoiceMessage) => {
      switch (msg.type) {
        case "voice_partial":
        case "voice_final":
          handleVoiceTranscript(msg, { baseRef, apply, reset });
          break;
        case "voice_level":
          handleVoiceLevel(msg, stateRef, setLevel);
          break;
        case "voice_error":
          handleVoiceError(msg, baseRef, reset, onError);
          break;
        case "voice_setup_progress":
          handleVoiceSetupProgress(msg, setSetup);
          break;
      }
    },
    [apply, onError, reset],
  );

  return { state, level, setup, start, finish, cancel, handleMessage };
}
