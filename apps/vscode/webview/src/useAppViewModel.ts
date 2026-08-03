import { useCallback, useReducer, useState, type RefObject } from "react";
import { appHasComposerContent } from "./chat/AppFooterSection.js";
import { useAutoScroll } from "./chat/hooks/useAutoScroll.js";
import { useChatShell } from "./chat/hooks/useChatShell.js";
import { useCountdown } from "./chat/hooks/useCountdown.js";
import { useEnhancePrompt } from "./chat/hooks/useEnhancePrompt.js";
import { useOpenTabs } from "./chat/hooks/useOpenTabs.js";
import { usePersistentFlag } from "./chat/hooks/usePersistentFlag.js";
import { chatReducer, initialChatState } from "./chat/state/chatReducer.js";
import type { ComposerHandle } from "./chat/composer/Composer.js";
import type { ComposerDoc } from "./chat/composer/model.js";
import type { ChangeItem, VsCodeApi } from "./chat/types.js";
import { useLocaleSync } from "./hooks/useLocaleSync.js";
import { useAppComposer, useAppMode, useAppVoiceLayer } from "./useAppViewModelParts.js";
import { useAppHostHandlers, useAppEscapeHandler } from "./useAppHostHandlers.js";

function useAppEditsUi(vscode: VsCodeApi) {
  const [expandedHunksPath, setExpandedHunksPath] = useState<string | null>(null);
  const [feedbackForPath, setFeedbackForPath] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [statsExpanded, setStatsExpanded] = usePersistentFlag(vscode, "sessionStatsExpanded", false);
  return {
    expandedHunksPath,
    setExpandedHunksPath,
    feedbackForPath,
    setFeedbackForPath,
    feedbackText,
    setFeedbackText,
    statsExpanded,
    setStatsExpanded,
  };
}

export function useAppViewModel(vscode: VsCodeApi) {
  const { locale, applyLocale } = useLocaleSync(document.body.dataset.locale ?? "en");
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const { mode, setMode, applyMode } = useAppMode(vscode);
  const tabs = useOpenTabs(vscode);
  const composer = useAppComposer(vscode, state.activeSessionId, tabs);
  const agentActive = state.runState === "running" || state.runState === "stopping";
  const { logRef, contentRef, stuck, hasNewContent, scrollToBottom, stickToBottom } = useAutoScroll();
  const shell = useChatShell({ vscode, dispatch, state, mode, applyMode, composer, tabs, stickToBottom });
  const editsUi = useAppEditsUi(vscode);
  const autoAcceptRemaining = useCountdown(state.autoAcceptDeadline);
  const { presence, voice } = useAppVoiceLayer({ vscode, dispatch, state, shell, composer, mode });

  const applyEnhancedDoc = useCallback(
    (doc: ComposerDoc, caret: number) => {
      composer.setDoc(doc, caret);
      composer.composerRef.current?.setDoc(doc, caret);
      composer.composerRef.current?.focus(caret);
    },
    [composer],
  );
  const onEnhanceError = useCallback(
    (message: string) => {
      dispatch({ kind: "host", message: { type: "error", text: message } });
    },
    [dispatch],
  );
  const enhance = useEnhancePrompt({
    vscode,
    doc: composer.doc,
    mode,
    applyDoc: applyEnhancedDoc,
    onError: onEnhanceError,
  });
  const [openModelMenuNonce, setOpenModelMenuNonce] = useState(0);

  useAppHostHandlers({
    vscode,
    dispatch,
    shell,
    composer,
    voice,
    enhance,
    stickToBottom,
    setMode,
    setExpandedHunksPath: editsUi.setExpandedHunksPath,
    setFeedbackForPath: editsUi.setFeedbackForPath,
    onLocale: applyLocale,
    onOpenModelMenu: () => setOpenModelMenuNonce((n) => n + 1),
  });

  const panelChanges: ChangeItem[] =
    state.changes.length > 0
      ? state.changes
      : state.pendingEdits.map((p) => ({ path: p, additions: 0, deletions: 0, sensitive: false }));

  return {
    vscode,
    locale,
    state,
    dispatch,
    mode,
    applyMode,
    tabs,
    composer,
    shell,
    enhance,
    logRef,
    contentRef,
    stuck,
    hasNewContent,
    stickToBottom,
    scrollToBottom,
    agentActive,
    presence,
    voice,
    onEscape: useAppEscapeHandler(composer, shell, voice),
    hasContent: appHasComposerContent(composer.doc),
    panelChanges,
    autoAcceptRemaining,
    composerRef: composer.composerRef as RefObject<ComposerHandle>,
    openModelMenuNonce,
    ...editsUi,
  };
}

export type AppViewModel = ReturnType<typeof useAppViewModel>;
