import { useCallback, useState } from "react";
import { useAppPresence } from "./chat/hooks/useAppPresence.js";
import { useVoice } from "./chat/hooks/useVoice.js";
import type { ChatAction, ChatState } from "./chat/state/chatReducer.js";
import { useComposerController } from "./chat/state/useComposerController.js";
import type { useOpenTabs } from "./chat/hooks/useOpenTabs.js";
import type { useChatShell } from "./chat/hooks/useChatShell.js";
import type { Mode, VsCodeApi } from "./chat/types.js";

type Shell = ReturnType<typeof useChatShell>;
type Composer = ReturnType<typeof useComposerController>;

export function useAppMode(vscode: VsCodeApi) {
  const [mode, setMode] = useState<Mode>("agent");
  const applyMode = useCallback(
    (m: Mode) => {
      setMode(m);
      vscode.postMessage({ type: "set_mode", mode: m });
    },
    [vscode],
  );
  return { mode, setMode, applyMode };
}

export function useAppComposer(
  vscode: VsCodeApi,
  activeSessionId: string | undefined,
  tabs: ReturnType<typeof useOpenTabs>,
) {
  const runBuiltinCommand = useCallback(
    (name: string): boolean => {
      if (name === "new") {
        tabs.focusDraftTab();
        vscode.postMessage({ type: "new_session" });
        return true;
      }
      if (name === "compact") {
        vscode.postMessage({ type: "compact_conversation" });
        return true;
      }
      return false;
    },
    [tabs, vscode],
  );

  return useComposerController({ vscode, activeSessionId, onBuiltinCommand: runBuiltinCommand });
}

export function useAppVoiceLayer({
  vscode,
  dispatch,
  state,
  shell,
  composer,
  mode,
}: {
  vscode: VsCodeApi;
  dispatch: (action: ChatAction) => void;
  state: ChatState;
  shell: Shell;
  composer: Composer;
  mode: Mode;
}) {
  const presence = useAppPresence({
    historyOpen: shell.historyOpen,
    plansOpen: shell.plansOpen,
    pickerOpen: composer.picker.open,
    menuItemsLength: composer.menuItems.length,
    menuItems: composer.menuItems,
    queueLength: state.queue.length,
    queue: state.queue,
    busy: shell.busy,
    todos: state.todos,
    changesLength: state.changes.length,
    pendingEditsLength: state.pendingEdits.length,
    mode,
    hypothesesLength: state.hypotheses.length,
    busyForPill: shell.busy,
    showDragTip: state.showDragTip,
    logLength: state.log.length,
  });

  const voice = useVoice(
    vscode,
    useCallback(
      (doc, caret) => {
        composer.setDoc(doc, caret);
        composer.composerRef.current?.setDoc(doc, caret);
      },
      [composer],
    ),
    useCallback((message: string) => {
      dispatch({ kind: "host", message: { type: "error", text: message } });
    }, [dispatch]),
  );

  return { presence, voice };
}
