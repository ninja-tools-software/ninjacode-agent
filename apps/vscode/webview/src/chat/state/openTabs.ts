import { NEW_SESSION_KEY } from "./drafts.js";

/** Tab id for a composer draft with no persisted session yet. */
export const DRAFT_TAB_ID = NEW_SESSION_KEY;

export type OpenTabId = string;

export interface OpenTabsState {
  tabIds: OpenTabId[];
  activeTabId: OpenTabId;
}

const DEFAULT_OPEN_TABS: OpenTabsState = {
  tabIds: [DRAFT_TAB_ID],
  activeTabId: DRAFT_TAB_ID,
};

export function isDraftTab(tabId: OpenTabId): boolean {
  return tabId === DRAFT_TAB_ID;
}

export function loadOpenTabs(raw: unknown): OpenTabsState {
  if (!raw || typeof raw !== "object") return DEFAULT_OPEN_TABS;
  const candidate = (raw as { openTabs?: unknown }).openTabs;
  if (!candidate || typeof candidate !== "object") return DEFAULT_OPEN_TABS;
  const { tabIds, activeTabId } = candidate as Partial<OpenTabsState>;
  if (!Array.isArray(tabIds) || tabIds.length === 0 || typeof activeTabId !== "string") {
    return DEFAULT_OPEN_TABS;
  }
  const ids = tabIds.filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return DEFAULT_OPEN_TABS;
  const active = ids.includes(activeTabId) ? activeTabId : ids[0]!;
  return { tabIds: ids, activeTabId: active };
}

export function withOpenTabs(previousState: unknown, tabs: OpenTabsState): Record<string, unknown> {
  const base = previousState && typeof previousState === "object" ? { ...previousState } : {};
  return { ...base, openTabs: tabs };
}

/** Ensure a tab id is present; optionally make it active. */
export function openTab(
  state: OpenTabsState,
  tabId: OpenTabId,
  makeActive = true,
): OpenTabsState {
  const tabIds = state.tabIds.includes(tabId) ? state.tabIds : [...state.tabIds, tabId];
  return {
    tabIds,
    activeTabId: makeActive ? tabId : state.activeTabId,
  };
}

export function activateTab(state: OpenTabsState, tabId: OpenTabId): OpenTabsState {
  if (!state.tabIds.includes(tabId)) return openTab(state, tabId, true);
  return { ...state, activeTabId: tabId };
}

/** Focus or create the single draft tab. */
export function focusDraftTab(state: OpenTabsState): OpenTabsState {
  if (state.tabIds.includes(DRAFT_TAB_ID)) {
    return { ...state, activeTabId: DRAFT_TAB_ID };
  }
  return {
    tabIds: [...state.tabIds, DRAFT_TAB_ID],
    activeTabId: DRAFT_TAB_ID,
  };
}

export function shouldPromoteDraftTab(state: OpenTabsState, sessionId: string): boolean {
  return state.tabIds.includes(DRAFT_TAB_ID) && !state.tabIds.includes(sessionId);
}

/** Replace the draft tab with a real session id after the first message. */
export function promoteDraftTab(state: OpenTabsState, sessionId: string): OpenTabsState {
  const hadDraft = state.tabIds.includes(DRAFT_TAB_ID);
  let tabIds = state.tabIds.map((id) => (id === DRAFT_TAB_ID ? sessionId : id));
  if (!hadDraft && !tabIds.includes(sessionId)) {
    tabIds = [...tabIds, sessionId];
  }
  // Dedupe in case sessionId was already open elsewhere.
  const seen = new Set<string>();
  tabIds = tabIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const activeTabId =
    state.activeTabId === DRAFT_TAB_ID || state.activeTabId === sessionId
      ? sessionId
      : state.activeTabId;
  return { tabIds, activeTabId };
}

/** Remove a tab from the bar without deleting the session. */
export function closeTab(state: OpenTabsState, tabId: OpenTabId): OpenTabsState {
  const idx = state.tabIds.indexOf(tabId);
  if (idx === -1) return state;

  const tabIds = state.tabIds.filter((id) => id !== tabId);
  if (tabIds.length === 0) {
    return DEFAULT_OPEN_TABS;
  }

  let activeTabId = state.activeTabId;
  if (state.activeTabId === tabId) {
    const neighbor = tabIds[idx] ?? tabIds[idx - 1] ?? tabIds[0]!;
    activeTabId = neighbor;
  }
  return { tabIds, activeTabId };
}

export function removeSessionTab(state: OpenTabsState, sessionId: string): OpenTabsState {
  return closeTab(state, sessionId);
}

export function tabTitleFor(
  tabId: OpenTabId,
  sessions: Array<{ id: string; title: string; pinned?: boolean }>,
  fallbackTitles?: Record<string, string>,
): { title: string; pinned: boolean } {
  if (isDraftTab(tabId)) return { title: "New Chat", pinned: false };
  const session = sessions.find((s) => s.id === tabId);
  if (!session) {
    const fallback = fallbackTitles?.[tabId]?.trim();
    if (fallback) return { title: fallback.slice(0, 80), pinned: false };
    return { title: "…", pinned: false };
  }
  return { title: session.title || "New Chat", pinned: Boolean(session.pinned) };
}

/** First user line while the host has not persisted the session title yet. */
export function fallbackTitleFromLog(
  log: Array<{ kind: string; text?: string }>,
): string | undefined {
  const firstUser = log.find((item) => item.kind === "user");
  if (!firstUser?.text) return undefined;
  const line = firstUser.text.split(/\r?\n/).find((l) => l.trim()) ?? firstUser.text;
  const trimmed = line.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}
