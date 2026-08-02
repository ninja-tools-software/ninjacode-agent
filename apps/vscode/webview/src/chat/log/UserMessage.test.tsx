import { isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { renderWithRefs } from "./UserMessage.js";
import type { ContextRef } from "../types.js";

function ref(partial: Partial<ContextRef> & Pick<ContextRef, "kind" | "target" | "label">): ContextRef {
  return { id: `${partial.kind}:${partial.target}`, status: "resolved", ...partial } as ContextRef;
}

/** Describe the output as a simple array: strings stay, badges become `[id]`. */
function shape(nodes: ReturnType<typeof renderWithRefs>): string[] {
  return nodes.map((node) => {
    if (typeof node === "string") return node;
    if (isValidElement<{ refItem: ContextRef }>(node)) return `[${node.props.refItem.id}]`;
    return "?";
  });
}

describe("renderWithRefs", () => {
  it("returns the raw text when nothing was attached", () => {
    expect(shape(renderWithRefs("hello", []))).toEqual(["hello"]);
  });

  it("swaps a mention for a badge, keeping the surrounding words", () => {
    const file = ref({ kind: "file", target: "src/a.ts", label: "a.ts" });
    expect(shape(renderWithRefs("look at @src/a.ts now", [file]))).toEqual([
      "look at ",
      "[file:src/a.ts]",
      " now",
    ]);
  });

  it("keeps badges in the order they appear in the sentence", () => {
    const a = ref({ kind: "file", target: "a.ts", label: "a.ts" });
    const b = ref({ kind: "file", target: "b.ts", label: "b.ts" });
    expect(shape(renderWithRefs("@b.ts then @a.ts", [a, b]))).toEqual([
      "[file:b.ts]",
      " then ",
      "[file:a.ts]",
    ]);
  });

  it("prefers the longest mention when one is a prefix of another", () => {
    const short = ref({ kind: "file", target: "src/a.ts", label: "a.ts" });
    const long = ref({ kind: "file", target: "src/a.test.ts", label: "a.test.ts" });
    expect(shape(renderWithRefs("see @src/a.test.ts", [short, long]))).toEqual([
      "see ",
      "[file:src/a.test.ts]",
    ]);
  });

  it("renders url, image and diagnostics mentions with their own syntax", () => {
    const url = ref({ kind: "url", target: "https://x.dev", label: "x.dev" });
    const image = ref({ kind: "image", target: "p.png", label: "p.png" });
    const problems = ref({ kind: "diagnostics", target: "src/a.ts", label: "a.ts problems" });
    expect(shape(renderWithRefs("https://x.dev", [url]))).toEqual(["[url:https://x.dev]"]);
    expect(shape(renderWithRefs("[image: p.png]", [image]))).toEqual(["[image:p.png]"]);
    expect(shape(renderWithRefs("@src/a.ts (problems)", [problems]))).toEqual([
      "[diagnostics:src/a.ts]",
    ]);
  });

  it("leaves the text alone when a ref's mention is absent", () => {
    const missing = ref({ kind: "file", target: "gone.ts", label: "gone.ts" });
    expect(shape(renderWithRefs("nothing here", [missing]))).toEqual(["nothing here"]);
  });
});
