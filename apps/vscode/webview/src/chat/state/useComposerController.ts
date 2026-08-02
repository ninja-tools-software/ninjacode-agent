import { useCallback, useMemo } from "react";
import { docToText, isEmpty, refsOf } from "../composer/model.js";
import { totalRefTokens } from "../composer/refBadgeView.js";
import type { ContextRef, VsCodeApi } from "../types.js";
import { useComposerDrafts } from "./useComposerDrafts.js";
import { useComposerMenu } from "./useComposerMenu.js";
import { useComposerPicker } from "./useComposerPicker.js";
import { useComposerResolution } from "./useComposerResolution.js";

interface ComposerControllerOptions {
  vscode: VsCodeApi;
  activeSessionId?: string;
  onBuiltinCommand: (name: string) => boolean;
}

export function useComposerController({
  vscode,
  activeSessionId,
  onBuiltinCommand,
}: ComposerControllerOptions) {
  const drafts = useComposerDrafts(vscode, activeSessionId);
  const resolution = useComposerResolution(vscode, drafts.composerRef, drafts.docRef, drafts.setDocState);
  const pickerApi = useComposerPicker(vscode, {
    place: resolution.place,
    queueContextPick: resolution.queueContextPick,
    queueSelectionPick: resolution.queueSelectionPick,
    queueFilesPick: resolution.queueFilesPick,
  });
  const menu = useComposerMenu(vscode, drafts.composerRef, onBuiltinCommand, resolution.requestResolution);

  const refs = useMemo(() => refsOf(drafts.doc), [drafts.doc]);

  const clear = useCallback(() => {
    drafts.clear();
    menu.clearToken();
  }, [drafts, menu]);

  return {
    doc: drafts.doc,
    refs,
    attachedTokens: totalRefTokens(refs),
    hasContent: !isEmpty(drafts.doc) || refs.length > 0 || docToText(drafts.doc).length > 0,
    setDoc: drafts.setDoc,
    clear,
    composerRef: drafts.composerRef,
    picker: pickerApi.picker,
    token: menu.token,
    menuItems: menu.menuItems,
    menuIndex: menu.menuIndex,
    setMenuIndex: menu.setMenuIndex,
    onToken: menu.onToken,
    acceptMenuItem: menu.acceptMenuItem,
    setMentions: menu.setMentions,
    setSlashCommands: menu.setSlashCommands,
    onDropItems: resolution.onDropItems,
    onDropSuggestion: resolution.onDropSuggestion,
    onContextResolved: pickerApi.onContextResolved,
    onRefsResolved: pickerApi.onRefsResolved,
    insertRefsAt: resolution.insertRefsAt,
    openRef: (ref: ContextRef) => vscode.postMessage({ type: "open_ref", ref }),
    previewRef: resolution.previewRef,
    onRefPreview: resolution.onRefPreview,
  };
}
