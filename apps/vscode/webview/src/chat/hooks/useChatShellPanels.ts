import { useCallback, useEffect, useMemo, useState } from "react";
import { DRAFT_TAB_ID, fallbackTitleFromLog, isDraftTab, shouldPromoteDraftTab, type OpenTabId } from "../state/openTabs.js";
import type { ChatAction, ChatState } from "../state/chatReducer.js";
import type { SettingsState } from "../types.js";
import type { useOpenTabs } from "./useOpenTabs.js";
import type { VsCodeApi } from "../types.js";

type OpenTabs = ReturnType<typeof useOpenTabs>;

export function useChatShellPanels(state: ChatState) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [plansOpen, setPlansOpen] = useState(false);
  const [plansQuery, setPlansQuery] = useState("");
  const [plansLoading, setPlansLoading] = useState(false);

  const filteredSessions = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return state.sessions;
    return state.sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.preview.toLowerCase().includes(q) ||
        (s.model ?? "").toLowerCase().includes(q) ||
        (s.provider ?? "").toLowerCase().includes(q),
    );
  }, [state.sessions, historyQuery]);

  const filteredPlans = useMemo(() => {
    const q = plansQuery.trim().toLowerCase();
    if (!q) return state.plans;
    return state.plans.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.preview.toLowerCase().includes(q) ||
        p.relPath.toLowerCase().includes(q),
    );
  }, [state.plans, plansQuery]);

  useEffect(() => {
    if (plansLoading) setPlansLoading(false);
  }, [state.plans, plansLoading]);

  return {
    historyOpen,
    setHistoryOpen,
    historyQuery,
    setHistoryQuery,
    plansOpen,
    setPlansOpen,
    plansQuery,
    setPlansQuery,
    plansLoading,
    setPlansLoading,
    filteredSessions,
    filteredPlans,
  };
}

export function useChatShellSessionMeta(state: ChatState) {
  const activeSession = useMemo(
    () => state.sessions.find((s) => s.id === state.activeSessionId),
    [state.sessions, state.activeSessionId],
  );

  const tabFallbackTitles = useMemo(() => {
    if (!state.activeSessionId || activeSession) return undefined;
    const title = fallbackTitleFromLog(state.log);
    return title ? { [state.activeSessionId]: title } : undefined;
  }, [state.activeSessionId, state.log, activeSession]);

  return { activeSession, tabFallbackTitles };
}

interface TabShellOptions {
  vscode: VsCodeApi;
  dispatch: (action: ChatAction) => void;
  state: ChatState;
  tabs: OpenTabs;
  setHistoryOpen: (open: boolean) => void;
}

export function useChatShellTabs({ vscode, dispatch, state, tabs, setHistoryOpen }: TabShellOptions) {
  const switchHostToTab = useCallback(
    (tabId: OpenTabId) => {
      if (isDraftTab(tabId)) {
        vscode.postMessage({ type: "new_session" });
        return;
      }
      dispatch({ kind: "sessions_loading", loading: true });
      vscode.postMessage({ type: "switch_session", sessionId: tabId });
    },
    [dispatch, vscode],
  );

  useEffect(() => {
    const sid = state.activeSessionId;
    if (!sid) return;
    if (shouldPromoteDraftTab(tabs.tabs, sid)) {
      tabs.promoteDraftTab(sid);
      return;
    }
    if (!tabs.tabs.tabIds.includes(sid)) tabs.openTab(sid, true);
    else if (tabs.tabs.activeTabId !== sid) tabs.activateTab(sid);
  }, [state.activeSessionId, tabs]);

  useEffect(() => {
    if (state.sessionsLoading) return;
    for (const tabId of tabs.tabs.tabIds) {
      if (isDraftTab(tabId) || tabId === state.activeSessionId) continue;
      if (!state.sessions.some((s) => s.id === tabId)) tabs.removeSessionTab(tabId);
    }
  }, [state.activeSessionId, state.sessions, state.sessionsLoading, tabs]);

  const handleTabSelect = useCallback(
    (tabId: OpenTabId) => {
      if (tabId === tabs.tabs.activeTabId) return;
      tabs.activateTab(tabId);
      switchHostToTab(tabId);
    },
    [switchHostToTab, tabs],
  );

  const handleTabClose = useCallback(
    (tabId: OpenTabId) => {
      const wasActive = tabId === tabs.tabs.activeTabId;
      const next = tabs.closeTab(tabId);
      if (wasActive) switchHostToTab(next.activeTabId);
    },
    [switchHostToTab, tabs],
  );

  const handleNewSession = useCallback(() => {
    setHistoryOpen(false);
    tabs.focusDraftTab();
    switchHostToTab(DRAFT_TAB_ID);
  }, [setHistoryOpen, switchHostToTab, tabs]);

  return { handleTabSelect, handleTabClose, handleNewSession };
}

export function useChatShellModelInfo(settings: SettingsState | null) {
  return useMemo(() => {
    if (!settings) return undefined;
    return settings.models.find((m) => m.id === settings.model) ?? settings.modelInfo;
  }, [settings]);
}
