import { beforeEach, describe, expect, it } from "vitest";
import type { ContextRef } from "../types.js";
import { BADGE_ATTR, badgeIdFromEvent, createBadgeElement, domToOffset, getCaret, readDoc, renderDoc, setCaret } from "./dom.js";
import { docFromText, docLength, insertRefs, normalize } from "./model.js";

function ref(id: string, label = id): ContextRef {
  return { id, kind: "file", label, target: label, status: "resolved" };
}

let root: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  root.setAttribute("contenteditable", "plaintext-only");
  document.body.appendChild(root);
});

describe("createBadgeElement", () => {
  it("is atomic and draggable", () => {
    const el = createBadgeElement(ref("f1", "a.ts"));
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.getAttribute("draggable")).toBe("true");
    expect(el.getAttribute(BADGE_ATTR)).toBe("f1");
    expect(el.textContent).toBe("a.ts");
  });

  it("shows a spinner while the host resolves it", () => {
    const el = createBadgeElement({ ...ref("f1"), status: "pending" });
    expect(el.querySelector(".ref-badge-spinner")).not.toBeNull();
    expect(el.className).toContain("ref-status-pending");
  });

  it("includes the line range in the label", () => {
    const el = createBadgeElement({ ...ref("f1", "a.ts"), range: { start: 10, end: 20 } });
    expect(el.textContent).toBe("a.ts:10-20");
  });
});

describe("renderDoc / readDoc", () => {
  it("round-trips text and badges", () => {
    const doc = insertRefs(docFromText("look at "), 8, [ref("f1", "a.ts")]).doc;
    renderDoc(root, doc);
    const back = readDoc(root, new Map([["f1", ref("f1", "a.ts")]]));
    expect(back.nodes).toEqual(doc.nodes);
  });

  it("renders newlines as <br> and reads them back", () => {
    renderDoc(root, docFromText("a\nb"));
    expect(root.querySelectorAll("br")).toHaveLength(1);
    expect(readDoc(root, new Map()).nodes).toEqual([{ kind: "text", text: "a\nb" }]);
  });

  it("drops badges whose ref we no longer know", () => {
    renderDoc(root, insertRefs(docFromText(""), 0, [ref("gone")]).doc);
    expect(readDoc(root, new Map()).nodes).toEqual([{ kind: "text", text: " " }]);
  });

  it("clears the previous content on each render", () => {
    renderDoc(root, docFromText("first"));
    renderDoc(root, docFromText("second"));
    expect(root.textContent).toBe("second");
  });

  it("treats a browser-inserted div as a line break", () => {
    root.append(document.createTextNode("a"));
    const div = document.createElement("div");
    div.textContent = "b";
    root.appendChild(div);
    expect(readDoc(root, new Map()).nodes).toEqual([{ kind: "text", text: "a\nb" }]);
  });
});

describe("caret mapping", () => {
  it("maps a DOM position to a logical offset across badges", () => {
    const doc = normalize({
      nodes: [
        { kind: "text", text: "see " },
        { kind: "ref", ref: ref("f1") },
        { kind: "text", text: " now" },
      ],
    });
    renderDoc(root, doc);
    const lastText = root.childNodes[root.childNodes.length - 1]!;
    expect(domToOffset(root, lastText, 0)).toBe(5);
    expect(domToOffset(root, lastText, 4)).toBe(9);
    expect(domToOffset(root, root, root.childNodes.length)).toBe(docLength(doc));
  });

  it("round-trips through setCaret / getCaret", () => {
    const doc = insertRefs(docFromText("abc def"), 3, [ref("f1")]).doc;
    renderDoc(root, doc);
    setCaret(root, 6);
    expect(getCaret(root)?.focus).toBe(6);
  });

  it("supports a selection range", () => {
    renderDoc(root, docFromText("hello"));
    setCaret(root, 1, 4);
    expect(getCaret(root)).toEqual({ anchor: 1, focus: 4 });
  });

  it("returns null when the selection is outside the composer", () => {
    renderDoc(root, docFromText("hello"));
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(getCaret(root)).toBeNull();
  });

  it("clamps a caret past the end of the document", () => {
    renderDoc(root, docFromText("ab"));
    setCaret(root, 99);
    expect(getCaret(root)?.focus).toBe(2);
  });
});

describe("badgeIdFromEvent", () => {
  it("finds the badge under a click on its label", () => {
    const el = createBadgeElement(ref("f1"));
    root.appendChild(el);
    expect(badgeIdFromEvent(el.querySelector(".ref-badge-label"))).toBe("f1");
    expect(badgeIdFromEvent(root)).toBeNull();
    expect(badgeIdFromEvent(null)).toBeNull();
  });
});
