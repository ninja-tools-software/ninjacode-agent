import { describe, expect, it } from "vitest";
import { collectUris } from "./addToChatCommands.js";

function uri(p: string) {
  return { scheme: "file", path: p, fsPath: p, toString: () => `file://${p}` };
}

describe("collectUris", () => {
  it("returns nothing for an empty invocation", () => {
    expect(collectUris([])).toEqual([]);
    expect(collectUris([undefined, null])).toEqual([]);
  });

  it("reads the single-uri shape of the editor title menu", () => {
    expect(collectUris([uri("/a.ts")]).map((u) => u.path)).toEqual(["/a.ts"]);
  });

  it("prefers the explorer multi-selection and dedupes the leading uri", () => {
    const args = [uri("/a.ts"), [uri("/a.ts"), uri("/b.ts")]];
    expect(collectUris(args).map((u) => u.path)).toEqual(["/a.ts", "/b.ts"]);
  });

  it("unwraps source control resource states", () => {
    const args = [{ resourceUri: uri("/c.ts") }, [{ resourceUri: uri("/d.ts") }]];
    expect(collectUris(args).map((u) => u.path)).toEqual(["/c.ts", "/d.ts"]);
  });

  it("ignores values that are not uris", () => {
    expect(collectUris(["/a.ts", 42, { nope: true }])).toEqual([]);
  });
});
