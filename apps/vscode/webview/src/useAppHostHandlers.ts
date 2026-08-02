import { useCallback } from "react";
import { useHostMessages } from "./chat/hooks/useHostMessages.js";
import type { ChatAction } from "./chat/state/chatReducer.js";
import type { useComposerController } from "./chat/state/useComposerController.js";
import type { useChatShell } from "./chat/hooks/useChatShell.js";
import type { useEnhancePrompt } from "./chat/hooks/useEnhancePrompt.js";
import type { useVoice } from "./chat/hooks/useVoice.js";
import type { Mode, VsCodeApi } from "./chat/types.js";

type Shell = ReturnType<typeof useChatShell>;
type Composer = ReturnType<typeof useComposerController>;
type Voice = ReturnType<typeof useVoice>;
type Enhance = ReturnType<typeof useEnhancePrompt>;

interface UseAppHostHandlersOptions {
  vscode: VsCodeApi;
  dispatch: (action: ChatAction) => void;
  shell: Shell;
  composer: Composer;
  voice: Voice;
  enhance: Enhance;
  stickToBottom: () => void;
  setMode: (mode: Mode) => void;
  setExpandedHunksPath: (path: string | null) => void;
  setFeedbackForPath: (path: string | null) => void;
  onLocale?: (locale: string) => void;
}

export function useAppHostHandlers({
  vscode,
  dispatch,
  shell,
  composer,
  voice,
  enhance,
  stickToBottom,
  setMode,
  setExpandedHunksPath,
  setFeedbackForPath,
  onLocale,
}: UseAppHostHandlersOptions) {
  useHostMessages(vscode, dispatch, {
    onHydrate: stickToBottom,
    onClear: () => {
      stickToBottom();
      setExpandedHunksPath(null);
      setFeedbackForPath(null);
    },
    onSettings: (msg) => {
      const { type: _type, ...payload } = msg;
      shell.setSettings(payload);
      if (msg.mode) setMode(msg.mode);
      if (msg.locale) onLocale?.(msg.locale);
    },
    onLocale: (msg) => onLocale?.(msg.locale),
    onMode: (msg) => {
      setMode(msg.mode);
      // Host-driven mode changes only come from plan execution — re-engage
      // auto-scroll so the run is followed even if the user had scrolled up
      // to read the plan before hitting Execute.
      stickToBottom();
    },
    onCompose: (msg) => composer.composerRef.current?.insertText(msg.text),
    onMentionSuggestions: (msg) => composer.setMentions(msg.items ?? []),
    onContextSuggestions: (msg) => composer.picker.onSuggestions(msg.queryType, msg.items ?? []),
    onContextResolved: (msg) => composer.onContextResolved(msg.requestId, msg.ref),
    onRefsResolved: (msg) => composer.onRefsResolved(msg.requestId, msg.refs ?? []),
    onContextInsert: (msg) => composer.insertRefsAt(msg.refs ?? [], msg.at ?? "caret"),
    onRefPreview: (msg) => composer.onRefPreview(msg.requestId, msg.preview, msg.tokens),
    onSlashCommands: (msg) => composer.setSlashCommands(msg.builtins ?? [], msg.prompts ?? []),
    onVoice: voice.handleMessage,
    onEnhancePromptResult: (msg) => enhance.onResult(msg.requestId, msg.text),
    onEnhancePromptError: (msg) => enhance.onEnhanceError(msg.requestId, msg.text),
  });
}

export function useAppEscapeHandler(composer: Composer, shell: Shell, voice: Voice) {
  return useCallback(() => {
    if (voice.state !== "idle") {
      voice.cancel();
      return;
    }
    if (composer.picker.open) {
      composer.picker.close();
      return;
    }
    if (shell.busy) shell.stopAgent();
  }, [composer.picker, shell, voice]);
}
