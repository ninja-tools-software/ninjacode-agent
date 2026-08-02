import { describe, expect, it } from "vitest";
import type { ContextRef } from "../types.js";
import {
  EMPTY_DOC,
  clampOffset,
  deleteBackward,
  deleteForward,
  deleteRange,
  docEquals,
  docFromText,
  docLength,
  docToOffsetText,
  docToText,
  fromDraft,
  insertRefs,
  insertText,
  isEmpty,
  locate,
  moveRef,
  normalize,
  offsetOfNode,
  refsOf,
  removeRef,
  replaceTokenBeforeCaret,
  replaceTokenWithRefs,
  textBeforeCaret,
  toDraft,
  updateRefs,
} from "./model.js";

function ref(id: string, label = id): ContextRef {
  return { id, kind: "file", label, target: label, status: "resolved" };
}

describe("normalize", () => {
  it("merges adjacent text runs and drops empty ones", () => {
    const doc = normalize({
      nodes: [
        { kind: "text", text: "a" },
        { kind: "text", text: "" },
        { kind: "text", text: "b" },
        { kind: "ref", ref: ref("f1") },
        { kind: "text", text: "c" },
      ],
    });
    expect(doc.nodes).toEqual([
      { kind: "text", text: "ab" },
      { kind: "ref", ref: ref("f1") },
      { kind: "text", text: "c" },
    ]);
  });
});

describe("offsets", () => {
  const doc = normalize({
    nodes: [
      { kind: "text", text: "see " },
      { kind: "ref", ref: ref("f1", "a.ts") },
      { kind: "text", text: " now" },
    ],
  });

  it("counts a badge as exactly one position", () => {
    expect(docLength(doc)).toBe(4 + 1 + 4);
    expect(docToOffsetText(doc)).toHaveLength(docLength(doc));
  });

  it("locates offsets, snapping inside a badge to its start", () => {
    expect(locate(doc, 0)).toEqual({ index: 0, inner: 0 });
    expect(locate(doc, 4)).toEqual({ index: 1, inner: 0 });
    expect(locate(doc, 5)).toEqual({ index: 2, inner: 0 });
    expect(locate(doc, 99)).toEqual({ index: 3, inner: 0 });
  });

  it("reports the start offset of a node", () => {
    expect(offsetOfNode(doc, 1)).toBe(4);
    expect(offsetOfNode(doc, 2)).toBe(5);
  });

  it("clamps out-of-range offsets", () => {
    expect(clampOffset(doc, -5)).toBe(0);
    expect(clampOffset(doc, 500)).toBe(docLength(doc));
  });
});

describe("insertText", () => {
  it("inserts at the caret and returns the new caret", () => {
    const r = insertText(docFromText("hello world"), 5, ",");
    expect(docToText(r.doc)).toBe("hello, world");
    expect(r.caret).toBe(6);
  });

  it("splits around a badge without breaking it", () => {
    const base = insertRefs(docFromText("ab"), 1, [ref("f1")]).doc;
    const r = insertText(base, 1, "X");
    expect(base.nodes.filter((n) => n.kind === "ref")).toHaveLength(1);
    expect(r.doc.nodes.filter((n) => n.kind === "ref")).toHaveLength(1);
  });

  it("is a no-op for empty text", () => {
    const doc = docFromText("abc");
    expect(insertText(doc, 1, "").doc).toBe(doc);
  });
});

describe("insertRefs", () => {
  it("inserts a badge with a trailing space", () => {
    const r = insertRefs(docFromText("look at "), 8, [ref("f1", "a.ts")]);
    expect(r.doc.nodes).toEqual([
      { kind: "text", text: "look at " },
      { kind: "ref", ref: ref("f1", "a.ts") },
      { kind: "text", text: " " },
    ]);
    expect(r.caret).toBe(10);
  });

  it("does not add a space when the next character already is one", () => {
    const doc = docFromText("a b");
    const r = insertRefs(doc, 1, [ref("f1")]);
    expect(docToOffsetText(r.doc)).toBe("a\u2063 b");
  });

  it("moves an already-present badge instead of duplicating it", () => {
    const first = insertRefs(docFromText("start"), 5, [ref("f1")]).doc;
    const moved = insertRefs(first, 0, [ref("f1")]).doc;
    expect(moved.nodes.filter((n) => n.kind === "ref")).toHaveLength(1);
    expect(moved.nodes[0]).toEqual({ kind: "ref", ref: ref("f1") });
  });

  it("dedupes refs inside a single insertion", () => {
    const r = insertRefs(EMPTY_DOC, 0, [ref("f1"), ref("f1"), ref("f2")]);
    expect(refsOf(r.doc).map((x) => x.id)).toEqual(["f1", "f2"]);
  });

  it("is a no-op for an empty list", () => {
    const doc = docFromText("abc");
    expect(insertRefs(doc, 2, []).doc).toBe(doc);
  });
});

describe("deletion", () => {
  it("removes a whole badge on backspace", () => {
    const doc = insertRefs(docFromText("a"), 1, [ref("f1")]).doc;
    const afterBadge = 2;
    const r = deleteBackward(doc, afterBadge);
    expect(refsOf(r.doc)).toHaveLength(0);
    expect(r.caret).toBe(1);
  });

  it("does nothing at the start of the document", () => {
    const doc = docFromText("abc");
    expect(deleteBackward(doc, 0).doc).toBe(doc);
  });

  it("deletes forward", () => {
    const r = deleteForward(docFromText("abc"), 0);
    expect(docToText(r.doc)).toBe("bc");
  });

  it("deletes a range spanning text and badges", () => {
    const doc = insertRefs(docFromText("hello world"), 6, [ref("f1")]).doc;
    const r = deleteRange(doc, 0, docLength(doc));
    expect(isEmpty(r.doc)).toBe(true);
    expect(r.caret).toBe(0);
  });

  it("normalizes ranges given backwards", () => {
    expect(docToText(deleteRange(docFromText("abcd"), 3, 1).doc)).toBe("ad");
  });
});

describe("ref maintenance", () => {
  it("removes a badge by id", () => {
    const doc = insertRefs(docFromText("x"), 1, [ref("f1"), ref("f2")]).doc;
    expect(refsOf(removeRef(doc, "f1")).map((r) => r.id)).toEqual(["f2"]);
  });

  it("updates badges in place when the host resolves them", () => {
    const doc = insertRefs(EMPTY_DOC, 0, [{ ...ref("f1"), status: "pending" }]).doc;
    const updated = updateRefs(doc, [{ ...ref("f1"), status: "resolved", tokens: 42 }]);
    expect(refsOf(updated)[0]).toMatchObject({ status: "resolved", tokens: 42 });
  });

  it("moves a badge to another position", () => {
    const doc = insertRefs(docFromText("ab"), 2, [ref("f1")]).doc;
    const moved = moveRef(doc, "f1", 0).doc;
    expect(moved.nodes[0]).toEqual({ kind: "ref", ref: ref("f1") });
    expect(refsOf(moved)).toHaveLength(1);
  });

  it("ignores a move for an unknown id", () => {
    const doc = docFromText("ab");
    expect(moveRef(doc, "nope", 0).doc).toBe(doc);
  });
});

describe("autocomplete tokens", () => {
  it("returns the text typed since the last badge", () => {
    const doc = insertRefs(docFromText("see "), 4, [ref("f1")]).doc;
    const typed = insertText(doc, docLength(doc), "@ap");
    expect(textBeforeCaret(typed.doc, typed.caret)).toBe(" @ap");
  });

  it("replaces the token with text", () => {
    const doc = docFromText("run /comp");
    const r = replaceTokenBeforeCaret(doc, 9, 5, "/compact ");
    expect(docToText(r.doc)).toBe("run /compact");
    expect(r.caret).toBe(13);
  });

  it("replaces the token with badges", () => {
    const doc = docFromText("see @a.t");
    const r = replaceTokenWithRefs(doc, 8, 4, [ref("f1", "a.ts")]);
    expect(docToText(r.doc)).toBe("see");
    expect(refsOf(r.doc)).toHaveLength(1);
  });
});

describe("serialization", () => {
  it("round-trips a draft", () => {
    const doc = insertRefs(docFromText("hi "), 3, [ref("f1")]).doc;
    expect(docEquals(fromDraft(toDraft(doc)), doc)).toBe(true);
  });

  it("rejects malformed drafts", () => {
    expect(fromDraft(null).nodes).toEqual([]);
    expect(fromDraft({ nodes: "nope" }).nodes).toEqual([]);
    expect(fromDraft({ nodes: [{ kind: "text" }, { kind: "ref" }] }).nodes).toEqual([]);
  });

  it("keeps only literal text out of docToText", () => {
    const doc = insertRefs(docFromText("read "), 5, [ref("f1", "a.ts")]).doc;
    expect(docToText(doc)).toBe("read");
  });
});
