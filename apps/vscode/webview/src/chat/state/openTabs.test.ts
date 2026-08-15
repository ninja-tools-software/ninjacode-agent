import { describe, expect, it } from "vitest";
import {
  DRAFT_TAB_ID,
  activateTab,
  closeTab,
  focusDraftTab,
  openTab,
  promoteDraftTab,
  removeSessionTab,
  shouldPromoteDraftTab,
  tabTitleFor,
  fallbackTitleFromLog,
} from "./openTabs.js";

describe("openTabs", () => {
  it("opens a new tab and activates it", () => {
    const next = openTab({ tabIds: [DRAFT_TAB_ID], activeTabId: DRAFT_TAB_ID }, "s1");
    expect(next.tabIds).toEqual([DRAFT_TAB_ID, "s1"]);
    expect(next.activeTabId).toBe("s1");
  });

  it("does not duplicate an existing tab", () => {
    const base = { tabIds: ["s1", DRAFT_TAB_ID], activeTabId: DRAFT_TAB_ID };
    const next = openTab(base, "s1");
    expect(next.tabIds).toEqual(["s1", DRAFT_TAB_ID]);
    expect(next.activeTabId).toBe("s1");
  });

  it("promotes the draft tab to a session id", () => {
    const next = promoteDraftTab({ tabIds: [DRAFT_TAB_ID], activeTabId: DRAFT_TAB_ID }, "s1");
    expect(next.tabIds).toEqual(["s1"]);
    expect(next.activeTabId).toBe("s1");
  });

  it("closes a tab and selects a neighbor", () => {
    const next = closeTab({ tabIds: ["s1", "s2", "s3"], activeTabId: "s2" }, "s2");
    expect(next.tabIds).toEqual(["s1", "s3"]);
    expect(next.activeTabId).toBe("s3");
  });

  it("creates a draft tab when the last tab is closed", () => {
    const next = closeTab({ tabIds: ["s1"], activeTabId: "s1" }, "s1");
    expect(next.tabIds).toEqual([DRAFT_TAB_ID]);
    expect(next.activeTabId).toBe(DRAFT_TAB_ID);
  });

  it("focuses an existing draft tab", () => {
    const next = focusDraftTab({ tabIds: ["s1"], activeTabId: "s1" });
    expect(next.tabIds).toEqual(["s1", DRAFT_TAB_ID]);
    expect(next.activeTabId).toBe(DRAFT_TAB_ID);
  });

  it("activates without duplicating", () => {
    const base = { tabIds: ["s1", "s2"], activeTabId: "s1" };
    expect(activateTab(base, "s2").activeTabId).toBe("s2");
  });

  it("openTab is a no-op when already open and active", () => {
    const base = { tabIds: ["s1", "s2"], activeTabId: "s1" };
    expect(openTab(base, "s1", true)).toBe(base);
  });

  it("activateTab is a no-op when already active", () => {
    const base = { tabIds: ["s1", "s2"], activeTabId: "s1" };
    expect(activateTab(base, "s1")).toBe(base);
  });

  it("removeSessionTab behaves like closeTab", () => {
    const next = removeSessionTab({ tabIds: ["s1", "s2"], activeTabId: "s1" }, "s1");
    expect(next.tabIds).toEqual(["s2"]);
    expect(next.activeTabId).toBe("s2");
  });

  it("shouldPromoteDraftTab when draft is open and session is new", () => {
    const state = { tabIds: [DRAFT_TAB_ID], activeTabId: DRAFT_TAB_ID };
    expect(shouldPromoteDraftTab(state, "s1")).toBe(true);
    expect(shouldPromoteDraftTab(promoteDraftTab(state, "s1"), "s1")).toBe(false);
  });

  it("uses a fallback title when the session list has not caught up", () => {
    const { title } = tabTitleFor("s1", [], { s1: "Explain this codebase" });
    expect(title).toBe("Explain this codebase");
  });

  it("derives fallback title from the first user log line", () => {
    expect(
      fallbackTitleFromLog([{ kind: "user", text: "Explain this codebase\n\nDetails" }]),
    ).toBe("Explain this codebase");
  });

  it("promotes draft even when another session was active before", () => {
    const next = promoteDraftTab(
      { tabIds: ["s1", DRAFT_TAB_ID], activeTabId: DRAFT_TAB_ID },
      "s2",
    );
    expect(next.tabIds).toEqual(["s1", "s2"]);
    expect(next.activeTabId).toBe("s2");
  });
});
