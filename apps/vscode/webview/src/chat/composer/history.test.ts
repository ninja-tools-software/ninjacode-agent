import { describe, expect, it } from "vitest";
import { ComposerHistory } from "./history.js";
import { docFromText, docToText } from "./model.js";

function entry(text: string) {
  return { doc: docFromText(text), caret: text.length };
}

describe("ComposerHistory", () => {
  it("starts with nothing to undo", () => {
    const h = new ComposerHistory(entry(""));
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it("undoes and redoes discrete edits", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("a"), false, 0);
    h.push(entry("ab"), false, 5_000);
    expect(docToText(h.undo()!.doc)).toBe("a");
    expect(docToText(h.undo()!.doc)).toBe("");
    expect(h.canUndo).toBe(false);
    expect(docToText(h.redo()!.doc)).toBe("a");
    expect(docToText(h.redo()!.doc)).toBe("ab");
    expect(h.canRedo).toBe(false);
  });

  it("coalesces fast consecutive typing into one entry", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("h"), true, 1_000);
    h.push(entry("he"), true, 1_100);
    h.push(entry("hel"), true, 1_200);
    expect(docToText(h.undo()!.doc)).toBe("");
  });

  it("does not coalesce across a pause", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("h"), true, 1_000);
    h.push(entry("hello"), true, 9_000);
    expect(docToText(h.undo()!.doc)).toBe("h");
  });

  it("stops coalescing when asked", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("a"), true, 1_000);
    h.breakCoalescing();
    h.push(entry("ab"), true, 1_050);
    expect(docToText(h.undo()!.doc)).toBe("a");
  });

  it("drops the redo stack once a new edit lands", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("a"), false, 0);
    h.undo();
    h.push(entry("b"), false, 5_000);
    expect(h.canRedo).toBe(false);
    expect(docToText(h.current.doc)).toBe("b");
  });

  it("keeps only the caret when the document is unchanged", () => {
    const h = new ComposerHistory(entry("abc"));
    h.push({ doc: docFromText("abc"), caret: 1 }, false, 0);
    expect(h.canUndo).toBe(false);
    expect(h.current.caret).toBe(1);
  });

  it("resets the whole stack", () => {
    const h = new ComposerHistory(entry(""));
    h.push(entry("a"), false, 0);
    h.reset(entry("fresh"));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(docToText(h.current.doc)).toBe("fresh");
  });
});
