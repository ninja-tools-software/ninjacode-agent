import { describe, expect, it } from "vitest";
import type { Message } from "@ninjacode/providers";
import {
  annotateListDir,
  annotateReadFile,
  listDirCovers,
  readRangeCovers,
  readRangeFromMeta,
  readRangesCover,
  softenSupersededReads,
} from "./toolAnnotations.js";

function readTool(content: string, toolCallId = "c1"): Message {
  return { role: "tool", name: "read_file", toolCallId, content };
}

function listDirTool(content: string, toolCallId = "c1"): Message {
  return { role: "tool", name: "list_dir", toolCallId, content };
}

describe("readRangeFromMeta", () => {
  it("treats a served full file as full", () => {
    expect(readRangeFromMeta("a.py", { startLine: 1, endLine: 10, totalLines: 10 })).toEqual({
      path: "a.py",
      full: true,
      start: 1,
      end: 10,
    });
  });

  it("treats a budget-truncated read as a closed partial range", () => {
    expect(readRangeFromMeta("a.py", { startLine: 1, endLine: 900, totalLines: 1042 })).toEqual({
      path: "a.py",
      full: false,
      start: 1,
      end: 900,
    });
  });

  it("does not infer full from missing meta", () => {
    // Without served-range meta we cannot claim full coverage.
    expect(readRangeFromMeta("a.py")).toEqual({
      path: "a.py",
      full: false,
      start: 1,
      end: 0,
    });
  });
});

describe("annotateReadFile", () => {
  it("annotates from the served range, not the call arguments", () => {
    // Caller asked for the whole file; tool only served L1-900.
    const annotated = annotateReadFile("base.py", "1|a\n", {
      startLine: 1,
      endLine: 900,
      totalLines: 1042,
    });
    expect(annotated).toBe("[path:base.py#L1-900]\n1|a\n");
  });

  it("omits the line range for a truly full served read", () => {
    const annotated = annotateReadFile("base.py", "1|a\n2|b\n", {
      startLine: 1,
      endLine: 2,
      totalLines: 2,
    });
    expect(annotated).toBe("[path:base.py]\n1|a\n2|b\n");
  });
});

describe("readRangeCovers", () => {
  it("full read covers any partial range", () => {
    expect(
      readRangeCovers(
        { path: "a.py", full: true, start: 1, end: null },
        { path: "a.py", full: false, start: 1, end: 158 },
      ),
    ).toBe(true);
  });

  it("complementary ranges do not cover each other alone", () => {
    const head = { path: "a.py", full: false, start: 1, end: 158 };
    const tail = { path: "a.py", full: false, start: 158, end: null };
    expect(readRangeCovers(tail, head)).toBe(false);
    expect(readRangeCovers(head, tail)).toBe(false);
  });
});

describe("readRangesCover", () => {
  it("covers an earlier range when later complementary pages form a union", () => {
    const earlier = { path: "a.py", full: false, start: 100, end: 200 };
    const later = [
      { path: "a.py", full: false, start: 90, end: 150 },
      { path: "a.py", full: false, start: 151, end: 210 },
    ];
    expect(readRangesCover(later, earlier)).toBe(true);
  });

  it("does not cover when the union still has a gap", () => {
    const earlier = { path: "a.py", full: false, start: 1, end: 100 };
    const later = [
      { path: "a.py", full: false, start: 1, end: 40 },
      { path: "a.py", full: false, start: 60, end: 100 },
    ];
    expect(readRangesCover(later, earlier)).toBe(false);
  });
});

describe("listDirCovers", () => {
  it("recursive listing covers a flat listing of the same path", () => {
    expect(listDirCovers({ path: "src/", recursive: true }, { path: "src/", recursive: false })).toBe(
      true,
    );
  });

  it("flat listing does not cover a recursive listing", () => {
    expect(listDirCovers({ path: "src/", recursive: false }, { path: "src/", recursive: true })).toBe(
      false,
    );
  });
});

describe("softenSupersededReads", () => {
  it("preserves complementary read ranges of the same file", () => {
    const head = annotateReadFile("base.py", "1|a\n", {
      startLine: 1,
      endLine: 158,
      totalLines: 300,
    });
    const tail = annotateReadFile("base.py", "158|z\n", {
      startLine: 158,
      endLine: 300,
      totalLines: 300,
    });
    const history: Message[] = [readTool(head, "c1"), readTool(tail, "c2")];

    const result = softenSupersededReads(history);

    expect(result[0]?.content).toBe(head);
    expect(result[1]?.content).toBe(tail);
  });

  it("supersedes a middle range once later complementary pages cover it", () => {
    const mid = annotateReadFile("base.py", "100|m\n", {
      startLine: 100,
      endLine: 200,
      totalLines: 400,
    });
    const left = annotateReadFile("base.py", "90|l\n", {
      startLine: 90,
      endLine: 150,
      totalLines: 400,
    });
    const right = annotateReadFile("base.py", "151|r\n", {
      startLine: 151,
      endLine: 210,
      totalLines: 400,
    });
    const history: Message[] = [readTool(mid, "c1"), readTool(left, "c2"), readTool(right, "c3")];

    const result = softenSupersededReads(history);

    expect(result[0]?.content).toContain("[superseded]");
    expect(result[1]?.content).toBe(left);
    expect(result[2]?.content).toBe(right);
  });

  it("supersedes partial reads when a later full read covers them", () => {
    const partial = annotateReadFile("base.py", "1|a\n", {
      startLine: 1,
      endLine: 50,
      totalLines: 100,
    });
    const full = annotateReadFile("base.py", "1|a\n2|b\n", {
      startLine: 1,
      endLine: 100,
      totalLines: 100,
    });
    const history: Message[] = [readTool(partial, "c1"), readTool(full, "c2")];

    const result = softenSupersededReads(history);

    expect(result[0]?.content).toContain("[superseded]");
    expect(result[1]?.content).toBe(full);
  });

  it("does not treat a budget-truncated 'whole file' call as covering unread ranges", () => {
    // Prior read of a range the truncated full-file call never reached.
    const early = annotateReadFile("base.py", "950|x\n", {
      startLine: 950,
      endLine: 1000,
      totalLines: 1042,
    });
    // Same call shape as a full-file request, but only L1-900 was served.
    const truncated = annotateReadFile("base.py", "1|a\n", {
      startLine: 1,
      endLine: 900,
      totalLines: 1042,
    });
    expect(truncated.startsWith("[path:base.py#L1-900]")).toBe(true);
    expect(truncated.startsWith("[path:base.py]\n")).toBe(false);

    const history: Message[] = [readTool(early, "c1"), readTool(truncated, "c2")];
    const result = softenSupersededReads(history);

    expect(result[0]?.content).toBe(early);
    expect(result[1]?.content).toBe(truncated);
  });

  it("preserves a recursive list_dir when a later flat listing is narrower", () => {
    const recursive = annotateListDir("src/", "src/a.ts\nsrc/b.ts\n", true);
    const flat = annotateListDir("src/", "src/a.ts\n", false);
    const history: Message[] = [listDirTool(recursive, "c1"), listDirTool(flat, "c2")];

    const result = softenSupersededReads(history);

    expect(result[0]?.content).toBe(recursive);
    expect(result[1]?.content).toBe(flat);
  });

  it("supersedes flat list_dir when a later recursive listing covers it", () => {
    const flat = annotateListDir("src/", "src/a.ts\n", false);
    const recursive = annotateListDir("src/", "src/a.ts\nsrc/b.ts\n", true);
    const history: Message[] = [listDirTool(flat, "c1"), listDirTool(recursive, "c2")];

    const result = softenSupersededReads(history);

    expect(result[0]?.content).toContain("[superseded]");
    expect(result[1]?.content).toBe(recursive);
  });
});
