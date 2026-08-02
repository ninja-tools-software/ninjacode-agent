import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isHttpUrl, resolveDropItems, toFsPath } from "./dropResolver.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-drop-"));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "a.ts"), "const a = 1;\n", "utf8");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("toFsPath", () => {
  it("accepts the uri forms VS Code and the OS produce", () => {
    expect(toFsPath("file:///tmp/x.ts")).toBe("/tmp/x.ts");
    expect(toFsPath("/tmp/x.ts")).toBe("/tmp/x.ts");
  });

  it("rejects remote schemes and relative paths", () => {
    expect(toFsPath("https://example.com/x.ts")).toBeUndefined();
    expect(toFsPath("untitled:Untitled-1")).toBeUndefined();
    expect(toFsPath("src/a.ts")).toBeUndefined();
    expect(toFsPath("   ")).toBeUndefined();
  });
});

describe("isHttpUrl", () => {
  it("only matches http(s)", () => {
    expect(isHttpUrl("https://x.dev")).toBe(true);
    expect(isHttpUrl("  http://x.dev ")).toBe(true);
    expect(isHttpUrl("ftp://x.dev")).toBe(false);
  });
});

describe("resolveDropItems", () => {
  it("makes a workspace-relative file ref out of an absolute path", async () => {
    const [ref] = await resolveDropItems(
      [{ kind: "uri", value: path.join(root, "src", "a.ts") }],
      root,
    );
    expect(ref).toMatchObject({ kind: "file", target: "src/a.ts", label: "a.ts", status: "resolved" });
  });

  it("marks a directory as a folder ref", async () => {
    const [ref] = await resolveDropItems([{ kind: "uri", value: path.join(root, "src") }], root);
    expect(ref).toMatchObject({ kind: "folder", target: "src", label: "src/" });
  });

  it("keeps an absolute target for paths outside the workspace", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-outside-"));
    await fs.writeFile(path.join(outside, "b.ts"), "b", "utf8");
    const [ref] = await resolveDropItems([{ kind: "uri", value: path.join(outside, "b.ts") }], root);
    expect(ref!.target).toBe(path.join(outside, "b.ts"));
    await fs.rm(outside, { recursive: true, force: true });
  });

  it("turns a dropped link into a url ref labelled by host", async () => {
    const [ref] = await resolveDropItems([{ kind: "text", value: "https://vitest.dev/guide" }], root);
    expect(ref).toMatchObject({ kind: "url", label: "vitest.dev" });
  });

  it("resolves a workspace-relative path dropped as plain text", async () => {
    const [ref] = await resolveDropItems([{ kind: "text", value: "src/a.ts" }], root);
    expect(ref).toMatchObject({ kind: "file", target: "src/a.ts" });
  });

  it("falls back to a snippet for free text, labelled by its first line", async () => {
    const [ref] = await resolveDropItems([{ kind: "text", value: "hello\nworld" }], root);
    expect(ref).toMatchObject({ kind: "snippet", label: "hello" });
    expect(ref!.detail).toContain("world");
  });

  it("keeps an image drop as a multimodal ref", async () => {
    const [ref] = await resolveDropItems(
      [
        {
          kind: "file",
          value: "shot.png",
          name: "shot.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,QUJD",
        },
      ],
      root,
    );
    expect(ref).toMatchObject({ kind: "image", label: "shot.png", mimeType: "image/png" });
  });

  it("uses the inlined contents when a sandboxed drop gives no path", async () => {
    const [ref] = await resolveDropItems(
      [{ kind: "file", value: "notes.md", name: "notes.md", text: "# hi" }],
      root,
    );
    expect(ref).toMatchObject({ kind: "snippet", label: "notes.md" });
    expect(ref!.detail).toContain("# hi");
  });

  it("skips items it cannot make sense of", async () => {
    expect(await resolveDropItems([{ kind: "text", value: "   " }], root)).toEqual([]);
    expect(await resolveDropItems([{ kind: "file", value: "ghost.bin" }], root)).toEqual([]);
  });

  it("preserves order across a multi-item drop", async () => {
    const refs = await resolveDropItems(
      [
        { kind: "uri", value: path.join(root, "src", "a.ts") },
        { kind: "text", value: "https://x.dev" },
      ],
      root,
    );
    expect(refs.map((r) => r.kind)).toEqual(["file", "url"]);
  });
});
