import { describe, expect, it } from "vitest";
import type { ContextRef } from "../types.js";
import { docFromText, docToText, insertRefs, refsOf } from "../composer/model.js";
import {
  EMPTY_STORE,
  NEW_SESSION_KEY,
  clearDraft,
  loadDrafts,
  readDraft,
  withDrafts,
  writeDraft,
} from "./drafts.js";

const fileRef: ContextRef = { id: "f1", kind: "file", label: "a.ts", target: "a.ts", status: "resolved" };

describe("draft storage", () => {
  it("round-trips a draft for a session", () => {
    const store = writeDraft(EMPTY_STORE, "s1", docFromText("half a thought"));
    expect(docToText(readDraft(store, "s1"))).toBe("half a thought");
  });

  it("keeps drafts of different sessions apart", () => {
    let store = writeDraft(EMPTY_STORE, "s1", docFromText("one"));
    store = writeDraft(store, "s2", docFromText("two"));
    expect(docToText(readDraft(store, "s1"))).toBe("one");
    expect(docToText(readDraft(store, "s2"))).toBe("two");
  });

  it("files a draft written before any session exists", () => {
    const store = writeDraft(EMPTY_STORE, undefined, docFromText("new chat"));
    expect(Object.keys(store.drafts)).toEqual([NEW_SESSION_KEY]);
    expect(docToText(readDraft(store, undefined))).toBe("new chat");
  });

  it("preserves badges", () => {
    const doc = insertRefs(docFromText("see "), 4, [fileRef]).doc;
    const store = writeDraft(EMPTY_STORE, "s1", doc);
    expect(refsOf(readDraft(store, "s1"))).toEqual([fileRef]);
  });

  it("keeps a draft that has badges but no text", () => {
    const doc = insertRefs(docFromText(""), 0, [fileRef]).doc;
    const store = writeDraft(EMPTY_STORE, "s1", doc);
    expect(refsOf(readDraft(store, "s1"))).toHaveLength(1);
  });

  it("drops the entry when the composer is emptied", () => {
    let store = writeDraft(EMPTY_STORE, "s1", docFromText("typing"));
    store = writeDraft(store, "s1", docFromText(""));
    expect(store.drafts).toEqual({});
    expect(store.order).toEqual([]);
  });

  it("clears a draft explicitly", () => {
    const store = clearDraft(writeDraft(EMPTY_STORE, "s1", docFromText("x")), "s1");
    expect(docToText(readDraft(store, "s1"))).toBe("");
  });

  it("forgets the stalest drafts past the cap", () => {
    let store = EMPTY_STORE;
    for (let i = 0; i < 60; i++) store = writeDraft(store, `s${i}`, docFromText(`draft ${i}`));
    expect(store.order).toHaveLength(50);
    expect(docToText(readDraft(store, "s0"))).toBe("");
    expect(docToText(readDraft(store, "s59"))).toBe("draft 59");
  });
});

describe("webview state integration", () => {
  it("survives a save/load round-trip", () => {
    const store = writeDraft(EMPTY_STORE, "s1", docFromText("persisted"));
    expect(docToText(readDraft(loadDrafts(withDrafts(null, store)), "s1"))).toBe("persisted");
  });

  it("leaves other webview state alone", () => {
    const merged = withDrafts({ scroll: 12 }, EMPTY_STORE);
    expect(merged.scroll).toBe(12);
    expect(merged.composerDrafts).toEqual(EMPTY_STORE);
  });

  it("tolerates missing or malformed state", () => {
    expect(loadDrafts(undefined)).toEqual(EMPTY_STORE);
    expect(loadDrafts({ composerDrafts: "nope" })).toEqual(EMPTY_STORE);
    expect(loadDrafts({ composerDrafts: { drafts: { s1: { nodes: [] } } } }).order).toEqual(["s1"]);
  });
});
