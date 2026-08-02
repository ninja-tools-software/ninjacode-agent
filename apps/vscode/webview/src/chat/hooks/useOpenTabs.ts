import { useCallback, useState } from "react";
import type { VsCodeApi } from "../types.js";
import {
  type OpenTabId,
  type OpenTabsState,
  activateTab as activateTabState,
  closeTab as closeTabState,
  focusDraftTab as focusDraftTabState,
  loadOpenTabs,
  openTab as openTabState,
  promoteDraftTab as promoteDraftTabState,
  removeSessionTab as removeSessionTabState,
  withOpenTabs,
} from "../state/openTabs.js";

type TabsUpdater = OpenTabsState | ((prev: OpenTabsState) => OpenTabsState);

function useTabPersistence(vscode: VsCodeApi) {
  const [tabs, setTabs] = useState<OpenTabsState>(() => loadOpenTabs(vscode.getState?.()));

  const persist = useCallback(
    (next: TabsUpdater) => {
      setTabs((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        const state = vscode.getState?.();
        const base = state && typeof state === "object" ? state : {};
        vscode.setState?.(withOpenTabs(base, resolved));
        return resolved;
      });
    },
    [vscode],
  );

  return { tabs, persist };
}

function useTabMutations(persist: (next: TabsUpdater) => void) {
  const openTab = useCallback(
    (tabId: OpenTabId, makeActive = true) => {
      persist((current) => openTabState(current, tabId, makeActive));
    },
    [persist],
  );

  const activateTab = useCallback(
    (tabId: OpenTabId) => {
      persist((current) => activateTabState(current, tabId));
    },
    [persist],
  );

  const closeTab = useCallback(
    (tabId: OpenTabId): OpenTabsState => {
      let resolved!: OpenTabsState;
      persist((current) => {
        resolved = closeTabState(current, tabId);
        return resolved;
      });
      return resolved;
    },
    [persist],
  );

  const focusDraftTab = useCallback((): OpenTabsState => {
    let resolved!: OpenTabsState;
    persist((current) => {
      resolved = focusDraftTabState(current);
      return resolved;
    });
    return resolved;
  }, [persist]);

  const promoteDraftTab = useCallback(
    (sessionId: string) => {
      persist((current) => promoteDraftTabState(current, sessionId));
    },
    [persist],
  );

  const removeSessionTab = useCallback(
    (sessionId: string) => {
      persist((current) => removeSessionTabState(current, sessionId));
    },
    [persist],
  );

  return { openTab, activateTab, closeTab, focusDraftTab, promoteDraftTab, removeSessionTab };
}

export function useOpenTabs(vscode: VsCodeApi) {
  const { tabs, persist } = useTabPersistence(vscode);
  const mutations = useTabMutations(persist);

  return { tabs, ...mutations };
}
