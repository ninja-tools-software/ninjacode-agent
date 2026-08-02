import { useState } from "react";
import type { ChatAction, ChatState } from "../state/chatReducer.js";
import type { useComposerController } from "../state/useComposerController.js";
import type { Mode, SettingsState, VsCodeApi } from "../types.js";
import type { useOpenTabs } from "./useOpenTabs.js";
import {
  useChatShellModelInfo,
  useChatShellPanels,
  useChatShellSessionMeta,
  useChatShellTabs,
} from "./useChatShellPanels.js";
import { useChatShellMenuKeys, useChatShellShortcuts, useChatShellSubmit } from "./useChatShellInput.js";

type Composer = ReturnType<typeof useComposerController>;
type OpenTabs = ReturnType<typeof useOpenTabs>;

interface UseChatShellOptions {
  vscode: VsCodeApi;
  dispatch: (action: ChatAction) => void;
  state: ChatState;
  mode: Mode;
  applyMode: (m: Mode) => void;
  composer: Composer;
  tabs: OpenTabs;
  stickToBottom: () => void;
}

export function useChatShell({
  vscode,
  dispatch,
  state,
  mode,
  applyMode,
  composer,
  tabs,
  stickToBottom,
}: UseChatShellOptions) {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const panels = useChatShellPanels(state);
  const sessionMeta = useChatShellSessionMeta(state);
  const tabHandlers = useChatShellTabs({ vscode, dispatch, state, tabs, setHistoryOpen: panels.setHistoryOpen });
  const { stopAgent, submit } = useChatShellSubmit({
    vscode,
    composer,
    stickToBottom,
    setHistoryOpen: panels.setHistoryOpen,
  });
  const onMenuKeyDown = useChatShellMenuKeys(composer);
  const modelInfo = useChatShellModelInfo(settings);

  const busy = state.runState === "running" || state.runState === "waiting" || state.runState === "stopping";
  useChatShellShortcuts({ vscode, mode, applyMode, busy, hasPlan: !!state.plan });

  return {
    settings,
    setSettings,
    modelInfo,
    ...panels,
    ...sessionMeta,
    ...tabHandlers,
    stopAgent,
    submit,
    onMenuKeyDown,
    busy,
  };
}
