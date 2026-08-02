import { describe, expect, it } from "vitest";
import { describeDrop, hasDroppableContent, parseDataTransfer, type DataTransferLike } from "./dropParser.js";

function transfer(data: Record<string, string>, files: File[] = []): DataTransferLike {
  return {
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    getData: (format) => data[format] ?? "",
    files,
  };
}

describe("hasDroppableContent", () => {
  it("accepts the formats every drop source uses", () => {
    expect(hasDroppableContent(["Files"])).toBe(true);
    expect(hasDroppableContent(["text/uri-list"])).toBe(true);
    expect(hasDroppableContent(["resourceurls"])).toBe(true);
    expect(hasDroppableContent(["text/plain"])).toBe(true);
  });

  it("ignores drags carrying nothing we can attach", () => {
    expect(hasDroppableContent([])).toBe(false);
    expect(hasDroppableContent(["application/x-moz-nativeimage"])).toBe(false);
  });
});

describe("parseDataTransfer", () => {
  it("reads a uri-list, skipping comments and blanks", async () => {
    const items = await parseDataTransfer(
      transfer({ "text/uri-list": "# comment\nfile:///a/b.ts\n\nfile:///a/c.ts\n" }),
    );
    expect(items).toEqual([
      { kind: "uri", value: "file:///a/b.ts" },
      { kind: "uri", value: "file:///a/c.ts" },
    ]);
  });

  it("reads the explorer's JSON resourceurls and decodes them", async () => {
    const items = await parseDataTransfer(
      transfer({ resourceurls: JSON.stringify(["file:///a/my%20file.ts"]) }),
    );
    expect(items).toEqual([{ kind: "uri", value: "file:///a/my file.ts" }]);
  });

  it("reads editor tab drags from codeeditors objects", async () => {
    const items = await parseDataTransfer(
      transfer({ codeeditors: JSON.stringify([{ resource: "file:///a/b.ts" }]) }),
    );
    expect(items).toEqual([{ kind: "uri", value: "file:///a/b.ts" }]);
  });

  it("dedupes the same resource announced in several formats", async () => {
    const items = await parseDataTransfer(
      transfer({
        "text/uri-list": "file:///a/b.ts",
        resourceurls: JSON.stringify(["file:///a/b.ts"]),
      }),
    );
    expect(items).toHaveLength(1);
  });

  it("ignores malformed JSON payloads", async () => {
    const items = await parseDataTransfer(transfer({ resourceurls: "{not json" }));
    expect(items).toEqual([]);
  });

  it("prefers URIs over the plain-text duplicate the explorer also sends", async () => {
    const items = await parseDataTransfer(
      transfer({ "text/uri-list": "file:///a/b.ts", "text/plain": "/a/b.ts" }),
    );
    expect(items).toEqual([{ kind: "uri", value: "file:///a/b.ts" }]);
  });

  it("falls back to plain text when there is nothing else", async () => {
    const items = await parseDataTransfer(transfer({ "text/plain": "https://example.com" }));
    expect(items).toEqual([{ kind: "text", value: "https://example.com" }]);
  });

  it("ignores whitespace-only text", async () => {
    expect(await parseDataTransfer(transfer({ "text/plain": "   \n" }))).toEqual([]);
  });

  it("inlines dropped text files and reads images as data URLs", async () => {
    const textFile = new File(["hello"], "notes.md", { type: "text/markdown" });
    const image = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const items = await parseDataTransfer(transfer({}, [textFile, image]));

    expect(items[0]).toMatchObject({ kind: "file", name: "notes.md", text: "hello" });
    expect(items[1]).toMatchObject({ kind: "file", name: "shot.png", mimeType: "image/png" });
    expect(items[1]!.dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe("describeDrop", () => {
  it("names the payload for the overlay", () => {
    expect(describeDrop(["Files"])).toBe("Drop files to attach");
    expect(describeDrop(["text/uri-list"])).toBe("Drop to attach");
    expect(describeDrop(["text/plain"])).toBe("Drop text to attach");
  });
});
