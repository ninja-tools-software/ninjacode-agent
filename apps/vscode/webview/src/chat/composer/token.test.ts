import { describe, expect, it } from "vitest";
import type { ContextRef } from "../types.js";
import { docFromText, docLength, insertRefs, insertText } from "./model.js";
import { tokenAt } from "./token.js";

const fileRef: ContextRef = { id: "f1", kind: "file", label: "a.ts", target: "a.ts", status: "resolved" };

function at(text: string) {
  const doc = docFromText(text);
  return tokenAt(doc, docLength(doc));
}

describe("tokenAt", () => {
  it("detects a mention at the caret", () => {
    expect(at("look at @src/app")).toEqual({ trigger: "@", query: "src/app", length: 8 });
  });

  it("detects a bare trigger", () => {
    expect(at("hello @")).toEqual({ trigger: "@", query: "", length: 1 });
  });

  it("ignores a mention that is not adjacent to the caret", () => {
    expect(at("@src/app and then")).toBeNull();
  });

  it("requires whitespace before the trigger", () => {
    expect(at("user@example")).toBeNull();
  });

  it("opens the command menu only at the start of the message", () => {
    expect(at("/comp")).toEqual({ trigger: "/", query: "comp", length: 5 });
    expect(at("run /comp")).toBeNull();
  });

  it("does not look through a badge", () => {
    const doc = insertRefs(docFromText("see "), 4, [fileRef]).doc;
    expect(tokenAt(doc, docLength(doc))).toBeNull();
  });

  it("finds a mention typed after a badge", () => {
    const withRef = insertRefs(docFromText("see "), 4, [fileRef]).doc;
    const typed = insertText(withRef, docLength(withRef), "@ap");
    expect(tokenAt(typed.doc, typed.caret)).toEqual({ trigger: "@", query: "ap", length: 3 });
  });
});
