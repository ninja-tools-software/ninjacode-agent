import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ContextRef } from "../protocol.js";
import {
  buildTask,
  createRef,
  dedupeRefs,
  estimateTokens,
  expandBareMentions,
  makeRefId,
  nodesToPromptText,
  refMention,
  resolveRefs,
  stripAttachedContext,
  withoutImages,
} from "./contextRefs.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "ninjacode-refs-"));
  await fs.writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf8");
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const env = () => ({ root, index: async () => undefined, recentFiles: [] });

function snippetRef(label: string, body: string): ContextRef {
  return createRef({ kind: "snippet", target: `snippet:${label}`, label, detail: body });
}

describe("makeRefId", () => {
  it("keys on kind, target and range so two spots in one file stay distinct", () => {
    expect(makeRefId("file", "src/a.ts")).toBe("file:src/a.ts");
    expect(makeRefId("selection", "src/a.ts", { start: 1, end: 4 })).toBe("selection:src/a.ts#1-4");
    expect(makeRefId("selection", "src/a.ts", { start: 5, end: 6 })).not.toBe(
      makeRefId("selection", "src/a.ts", { start: 1, end: 4 }),
    );
  });
});

describe("dedupeRefs", () => {
  it("keeps the first occurrence's position", () => {
    const a = snippetRef("a", "A");
    const b = snippetRef("b", "B");
    expect(dedupeRefs([a, b, { ...a }]).map((r) => r.label)).toEqual(["a", "b"]);
  });
});

describe("refMention", () => {
  it("renders each kind the way the model should read it back", () => {
    expect(refMention(createRef({ kind: "file", target: "src/a.ts", label: "a.ts" }))).toBe("@src/a.ts");
    expect(refMention(createRef({ kind: "url", target: "https://x.dev", label: "x.dev" }))).toBe("https://x.dev");
    expect(refMention(createRef({ kind: "image", target: "p.png", label: "p.png" }))).toBe("[image: p.png]");
    expect(refMention(createRef({ kind: "diagnostics", target: "src/a.ts", label: "a" }))).toBe(
      "@src/a.ts (problems)",
    );
  });
});

describe("nodesToPromptText", () => {
  it("keeps badges inline where the user typed them", () => {
    const text = nodesToPromptText([
      { kind: "text", text: "look at " },
      { kind: "ref", ref: createRef({ kind: "file", target: "src/a.ts", label: "a.ts" }) },
      { kind: "text", text: " and fix it" },
    ]);
    expect(text).toBe("look at @src/a.ts and fix it");
  });
});

describe("resolveRefs", () => {
  it("expands self-contained refs and counts their tokens", async () => {
    const { blocks, refs } = await resolveRefs([snippetRef("note", "hello world")], env());
    expect(blocks).toEqual(["### note\nhello world"]);
    expect(refs[0]!.status).toBe("resolved");
    expect(refs[0]!.tokens).toBe(estimateTokens("hello world"));
  });

  it("marks a ref with no captured content as failed instead of dropping it", async () => {
    const broken = createRef({ kind: "snippet", target: "snippet:x", label: "x" });
    const { refs, blocks } = await resolveRefs([broken], env());
    expect(refs[0]!.status).toBe("error");
    expect(blocks[0]).toContain("Missing content");
  });

  it("reports a provider failure on the badge rather than throwing", async () => {
    const missing = createRef({ kind: "file", target: "does/not/exist.ts", label: "exist.ts" });
    const { refs } = await resolveRefs([missing], env());
    expect(refs[0]!.status).toBe("error");
    expect(refs[0]!.error).toBeTruthy();
  });

  it("resolves a real workspace file through the provider registry", async () => {
    const { blocks, refs } = await resolveRefs(
      [createRef({ kind: "file", target: "a.ts", label: "a.ts" })],
      env(),
    );
    expect(refs[0]!.status).toBe("resolved");
    expect(blocks[0]).toContain("export const a = 1;");
  });

  it("truncates once the shared budget is exhausted", async () => {
    const big = snippetRef("big", "x".repeat(70_000));
    const after = snippetRef("after", "should be omitted");
    const { blocks } = await resolveRefs([big, after], env());
    expect(blocks[0]).toContain("[truncated — attached context budget reached]");
    expect(blocks[1]).toContain("[omitted — attached context budget exhausted]");
  });

  it("turns a data URL image into a multimodal part", async () => {
    const image = createRef({
      kind: "image",
      target: "p.png",
      label: "p.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,QUJD",
    });
    const { images } = await resolveRefs([image], env());
    expect(images).toEqual([{ type: "image", mimeType: "image/png", data: "QUJD" }]);
  });
});

describe("stripAttachedContext", () => {
  it("leaves a message without attachments untouched", () => {
    expect(stripAttachedContext("just a question")).toBe("just a question");
  });

  it("keeps a lone --- in the body", () => {
    expect(stripAttachedContext("before\n\n---\nafter")).toBe("before\n\n---\nafter");
  });
});

describe("expandBareMentions", () => {
  it("reads a typed @path that has no badge", async () => {
    const blocks = await expandBareMentions("check @a.ts please", env(), new Set());
    expect(blocks[0]).toContain("export const a = 1;");
  });

  it("skips a mention already attached as a badge", async () => {
    expect(await expandBareMentions("check @a.ts", env(), new Set(["a.ts"]))).toEqual([]);
  });

  it("leaves unknown mentions alone", async () => {
    expect(await expandBareMentions("ping @nobody", env(), new Set())).toEqual([]);
  });
});

describe("buildTask", () => {
  it("keeps the sentence intact and appends each ref once", async () => {
    const ref = createRef({ kind: "file", target: "a.ts", label: "a.ts" });
    const task = await buildTask(
      {
        text: "",
        nodes: [
          { kind: "text", text: "explain " },
          { kind: "ref", ref },
          { kind: "text", text: " briefly" },
        ],
        refs: [ref, { ...ref }],
      },
      env(),
    );
    expect(task.text.startsWith("explain @a.ts briefly")).toBe(true);
    expect(task.body).toBe("explain @a.ts briefly");
    expect(task.text.match(/### a\.ts/g)).toHaveLength(1);
    expect(task.refs).toHaveLength(1);
  });

  it("falls back to plain text when the composer sent no nodes", async () => {
    const task = await buildTask({ text: "  just text  " }, env());
    expect(task.text).toBe("just text");
  });

  it("produces a prompt whose sentence survives a round-trip through history", async () => {
    const task = await buildTask({ text: "explain @a.ts", refs: [snippetRef("n", "N")] }, env());
    expect(stripAttachedContext(task.text)).toBe("explain @a.ts");
  });

  it("appends extra sections after the attached context", async () => {
    const task = await buildTask({ text: "hi", refs: [snippetRef("n", "N")] }, env(), ["Env: test"]);
    expect(task.text.indexOf("Attached context")).toBeLessThan(task.text.indexOf("Env: test"));
  });
});

describe("withoutImages", () => {
  const imageRef = (): ContextRef =>
    createRef({
      kind: "image",
      target: "shot.png",
      label: "shot.png",
      dataUrl: "data:image/png;base64,QUJD",
      mimeType: "image/png",
    });

  it("is a no-op when the task carries no image", async () => {
    const task = await buildTask({ text: "hi" }, env());
    expect(withoutImages(task)).toBe(task);
  });

  it("drops image parts and explains the omission in the prompt", async () => {
    const task = withoutImages(await buildTask({ text: "look", refs: [imageRef()] }, env()));
    expect(task.images).toEqual([]);
    expect(task.text).toContain("### shot.png");
    expect(task.text).toContain("no vision support");
    expect(task.text.match(/Attached context/g)).toHaveLength(1);
  });

  it("marks the image badge as failed so the user sees why", async () => {
    const task = withoutImages(await buildTask({ text: "look", refs: [imageRef()] }, env()));
    expect(task.refs[0]).toMatchObject({ kind: "image", status: "error" });
    expect(task.refs[0]?.error).toContain("vision");
  });

  it("keeps other refs untouched", async () => {
    const built = await buildTask({ text: "look", refs: [imageRef(), snippetRef("n", "N")] }, env());
    const task = withoutImages(built);
    expect(task.refs.find((r) => r.kind === "snippet")).toMatchObject({ status: "resolved" });
  });
});
