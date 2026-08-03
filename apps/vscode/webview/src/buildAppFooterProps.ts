import type { AppViewModel } from "./useAppViewModel.js";
import { docLength, voicePlaceholder } from "./chat/AppFooterSection.js";
import type { AppComposerAreaProps } from "./chat/AppComposerArea.js";
import type { AppPanelsProps } from "./chat/AppPanels.js";

function buildAppPanelsProps(vm: AppViewModel): AppPanelsProps {
  return {
    queueMounted: vm.presence.queuePresence.mounted,
    queueClosing: vm.presence.queuePresence.closing,
    queue: vm.presence.queuePresence.value,
    changesMounted: vm.presence.changesPresence.mounted,
    changesClosing: vm.presence.changesPresence.closing,
    changes: vm.panelChanges,
    autoAcceptRemaining: vm.autoAcceptRemaining,
    expandedHunksPath: vm.expandedHunksPath,
    setExpandedHunksPath: vm.setExpandedHunksPath,
    hunksByPath: vm.state.hunksByPath,
    feedbackForPath: vm.feedbackForPath,
    setFeedbackForPath: vm.setFeedbackForPath,
    feedbackText: vm.feedbackText,
    setFeedbackText: vm.setFeedbackText,
    todosMounted: vm.presence.todosPresence.mounted,
    todosClosing: vm.presence.todosPresence.closing,
    todos: vm.presence.todosPresence.value,
    busy: vm.shell.busy,
    onStop: vm.shell.stopAgent,
    vscode: vm.vscode,
  };
}

function buildComposerAreaProps(vm: AppViewModel, onDismissDragTip: () => void): AppComposerAreaProps {
  return {
    dragTipMounted: vm.presence.dragTipPresence.mounted,
    dragTipClosing: vm.presence.dragTipPresence.closing,
    onDismissDragTip,
    contextUsage: vm.state.contextUsage,
    attachedTokens: vm.composer.attachedTokens,
    onCompact: () => vm.vscode.postMessage({ type: "compact_conversation" }),
    pickerMounted: vm.presence.pickerPresence.mounted,
    pickerClosing: vm.presence.pickerPresence.closing,
    picker: vm.composer.picker,
    menuMounted: vm.presence.menuPresence.mounted,
    menuClosing: vm.presence.menuPresence.closing,
    menuItems: vm.composer.menuItems,
    menuIndex: vm.composer.menuIndex,
    menuClassName: vm.composer.token?.trigger === "@" ? "slash-menu mention-menu" : "slash-menu",
    onMenuHover: vm.composer.setMenuIndex,
    onMenuPick: (index) => vm.composer.acceptMenuItem(index),
    composerRef: vm.composerRef,
    doc: vm.composer.doc,
    onDocChange: vm.composer.setDoc,
    placeholder: voicePlaceholder(vm.mode, vm.voice.state),
    onMenuKeyDown: vm.shell.onMenuKeyDown,
    onToken: vm.composer.onToken,
    onSubmit: () => vm.shell.submit(vm.shell.busy ? "queue" : undefined),
    onEscape: vm.onEscape,
    onDropItems: vm.composer.onDropItems,
    onDropSuggestion: vm.composer.onDropSuggestion,
    onOpenRef: vm.composer.openRef,
    onPreviewRef: vm.composer.previewRef,
    onFocusChange: (focused) => vm.vscode.postMessage({ type: "chat_focus", focused }),
    mode: vm.mode,
    setMode: vm.applyMode,
    settings: vm.shell.settings,
    setSettings: vm.shell.setSettings,
    modelInfo: vm.shell.modelInfo,
    busy: vm.shell.busy,
    hasContent: vm.hasContent,
    pickerOpen: vm.composer.picker.open,
    voiceState: vm.voice.state,
    voiceLevel: vm.voice.level,
    voiceSetup: vm.voice.setup,
    showEnhance: vm.shell.settings?.provider === "gateway",
    enhancing: vm.enhance.enhancing,
    onEnhancePrompt: vm.enhance.enhance,
    onTogglePicker: vm.composer.picker.toggle,
    onStop: vm.shell.stopAgent,
    onStartVoice: () =>
      vm.voice.start(vm.composer.doc, vm.composer.composerRef.current?.caret() ?? docLength(vm.composer.doc)),
    onFinishVoice: vm.voice.finish,
    vscode: vm.vscode,
    openModelMenuNonce: vm.openModelMenuNonce,
  };
}

export function buildAppFooterProps(vm: AppViewModel, onDismissDragTip: () => void) {
  return { ...buildAppPanelsProps(vm), ...buildComposerAreaProps(vm, onDismissDragTip) };
}
