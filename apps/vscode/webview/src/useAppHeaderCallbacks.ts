import { useCallback } from "react";
import type { AppHeaderProps } from "./chat/AppHeader.types.js";
import type { AppViewModel } from "./useAppViewModel.js";

function buildHeaderProps(vm: AppViewModel, handlers: ReturnType<typeof useHeaderActionHandlers>): AppHeaderProps {
  const { vscode, state, tabs, shell } = vm;
  return {
    tabIds: tabs.tabs.tabIds,
    activeTabId: tabs.tabs.activeTabId,
    sessions: state.sessions,
    fallbackTitles: shell.tabFallbackTitles,
    activeSession: shell.activeSession,
    historyOpen: shell.historyOpen,
    sessionsLoading: state.sessionsLoading,
    onTabSelect: shell.handleTabSelect,
    onTabClose: shell.handleTabClose,
    onToggleHistory: handlers.toggleHistory,
    onHistoryClose: () => shell.setHistoryOpen(false),
    historyClosing: vm.presence.historyPresence.closing,
    historyMounted: vm.presence.historyPresence.mounted,
    historySessions: shell.filteredSessions,
    historyQuery: shell.historyQuery,
    onHistoryQuery: shell.setHistoryQuery,
    activeSessionId: state.activeSessionId,
    onHistoryOpen: handlers.openHistorySession,
    onHistoryDelete: (id) => vscode.postMessage({ type: "delete_session", sessionId: id }),
    plansOpen: shell.plansOpen,
    plansClosing: vm.presence.plansPresence.closing,
    plansMounted: vm.presence.plansPresence.mounted,
    plansItems: shell.filteredPlans,
    plansQuery: shell.plansQuery,
    activePlanId: state.plan?.id,
    plansLoading: shell.plansLoading,
    onTogglePlans: handlers.togglePlans,
    onPlansClose: () => shell.setPlansOpen(false),
    onPlansQuery: shell.setPlansQuery,
    onPlanOpen: handlers.openPlan,
    onPlanActivate: (planId) => vscode.postMessage({ type: "activate_plan", planId }),
    onPlanDelete: (planId) => vscode.postMessage({ type: "delete_plan", planId }),
    onNewSession: shell.handleNewSession,
    onOpenSettings: handlers.openSettings,
    vscode,
  };
}

function useHeaderActionHandlers(vm: AppViewModel) {
  const { vscode, dispatch, tabs, shell } = vm;

  const toggleHistory = useCallback(() => {
    const next = !shell.historyOpen;
    shell.setHistoryOpen(next);
    if (next) {
      shell.setPlansOpen(false);
      vscode.postMessage({ type: "list_sessions" });
    }
  }, [shell, vscode]);

  const openHistorySession = useCallback(
    (id: string) => {
      tabs.openTab(id, true);
      dispatch({ kind: "sessions_loading", loading: true });
      shell.setHistoryOpen(false);
      vscode.postMessage({ type: "switch_session", sessionId: id });
    },
    [dispatch, shell, tabs, vscode],
  );

  const togglePlans = useCallback(() => {
    const next = !shell.plansOpen;
    shell.setPlansOpen(next);
    if (next) {
      shell.setHistoryOpen(false);
      shell.setPlansLoading(true);
      vscode.postMessage({ type: "list_plans" });
    }
  }, [shell, vscode]);

  const openPlan = useCallback(
    (planId: string) => {
      shell.setPlansOpen(false);
      vscode.postMessage({ type: "open_plan", planId });
    },
    [shell, vscode],
  );

  const openSettings = useCallback(() => {
    shell.setHistoryOpen(false);
    vscode.postMessage({ type: "open_settings" });
  }, [shell, vscode]);

  const dismissDragTip = useCallback(() => {
    dispatch({ kind: "dismiss_drag_tip" });
    vscode.postMessage({ type: "dismiss_drag_tip" });
  }, [dispatch, vscode]);

  return { toggleHistory, openHistorySession, togglePlans, openPlan, openSettings, dismissDragTip };
}

export function useAppHeaderCallbacks(vm: AppViewModel) {
  const handlers = useHeaderActionHandlers(vm);
  return { props: buildHeaderProps(vm, handlers), dismissDragTip: handlers.dismissDragTip };
}
