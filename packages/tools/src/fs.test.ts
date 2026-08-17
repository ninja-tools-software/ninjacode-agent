import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { READ_FILE_MAX_CHARS, editFileTool, readFileTool, writeFileTool } from "./fs.js";
import type { ToolContext } from "./types.js";
import { ToolError } from "./types.js";

function ctx(root: string): ToolContext {
  return { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") };
}

describe("read_file", () => {
  it("adds a footer for partial reads that end before EOF", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(root, "sample.txt"), `${lines}\n`, "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "sample.txt", offset: 1, limit: 4 });

    expect(result.output).toContain("1|line 1");
    expect(result.output).toContain("[showing lines 1-4 of 10 total — continue with offset=5]");
    expect(result.meta).toMatchObject({ startLine: 1, endLine: 4, totalLines: 10, lines: 4 });
  });

  it("adds an end-of-file footer for partial reads that reach EOF", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(root, "tail.txt"), `${lines}\n`, "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "tail.txt", offset: 3 });

    expect(result.output).toContain("5|line 5");
    expect(result.output).toContain("[showing lines 3-5 of 5 total — end of file]");
  });

  it("omits a footer for full reads that fit the budget", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    await fs.writeFile(path.join(root, "full.txt"), "only\n", "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "full.txt" });

    expect(result.output).toBe("1|only");
    expect(result.meta).toMatchObject({ startLine: 1, endLine: 1, totalLines: 1, lines: 1 });
  });

  it("truncates oversized files on a line boundary and points to the next offset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    // Each numbered line is ~50 chars; enough lines to exceed READ_FILE_MAX_CHARS.
    const lineBody = "x".repeat(40);
    const lineCount = Math.ceil(READ_FILE_MAX_CHARS / 45) + 20;
    const content = Array.from({ length: lineCount }, () => lineBody).join("\n");
    await fs.writeFile(path.join(root, "big.txt"), `${content}\n`, "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "big.txt" });

    expect(result.output.length).toBeLessThanOrEqual(READ_FILE_MAX_CHARS + 120);
    expect(result.output).toContain("continue with offset=");
    const endLine = result.meta?.endLine as number;
    expect(endLine).toBeGreaterThan(1);
    expect(endLine).toBeLessThan(lineCount);
    expect(result.meta).toMatchObject({ startLine: 1, totalLines: lineCount });
    // No mid-line character cut: every content line starts with N|
    const contentLines = result.output.split("\n").filter((l) => /^\d+\|/.test(l));
    expect(contentLines.length).toBe(endLine);
  });

  it("truncates a single minified line without exhausting the whole budget", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    await fs.writeFile(path.join(root, "min.js"), `${"a".repeat(10_000)}\nsecond\n`, "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "min.js" });

    expect(result.output).toContain("[+");
    expect(result.output).toContain("chars on this line]");
    expect(result.output).toContain("2|second");
    expect(result.meta).toMatchObject({ startLine: 1, endLine: 2, totalLines: 2 });
  });

  it("throws when offset is beyond the end of the file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    await fs.writeFile(path.join(root, "small.txt"), "one\n", "utf8");

    await expect(readFileTool.execute(ctx(root), { path: "small.txt", offset: 5 })).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it("returns metadata instead of dumping a PPM image", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    const body = Array.from({ length: 50 }, () => "255 0 0 0 255 0 0 0 255").join("\n");
    await fs.writeFile(path.join(root, "image.ppm"), `P3\n2 2\n255\n${body}\n`, "utf8");

    const result = await readFileTool.execute(ctx(root), { path: "image.ppm" });

    expect(result.output).toContain("[data file] image.ppm");
    expect(result.output).toContain("Netpbm P3 2x2");
    expect(result.output).toContain("run_shell");
    expect(result.output).not.toContain("255 0 0");
    expect(result.meta).toMatchObject({ dataFile: true, kind: "image", width: 2, height: 2 });
  });

  it("returns metadata for a binary file with a NUL byte", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-read-"));
    await fs.writeFile(path.join(root, "blob.dat"), Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]));

    const result = await readFileTool.execute(ctx(root), { path: "blob.dat" });

    expect(result.output).toContain("[data file] blob.dat");
    expect(result.meta?.dataFile).toBe(true);
  });
});

describe("write_file verification", () => {
  it("warns on unbalanced HTML script tags", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-verify-"));
    const ctx: ToolContext = { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") };
    const result = await writeFileTool.execute(ctx, {
      path: "bad.html",
      content: "<html><body><script>console.log(1)</body></html>",
    });
    expect(result.output).toContain("Verification warning");
    expect(result.meta?.verifyError).toBeTruthy();
  });

  it("accepts well-formed HTML", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-verify-"));
    const ctx: ToolContext = { workspaceRoot: root, agentDir: path.join(root, ".ninjacode") };
    const result = await writeFileTool.execute(ctx, {
      path: "ok.html",
      content: "<html><body><script>console.log(1)</script></body></html>",
    });
    expect(result.output).not.toContain("Verification warning");
  });
});

describe("edit_file", () => {
  it("includes nearby lines when old_string is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-edit-"));
    await fs.writeFile(
      path.join(root, "app.ts"),
      "const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n",
      "utf8",
    );

    await expect(
      editFileTool.execute(ctx(root), {
        path: "app.ts",
        old_string: "const beta = 99;",
        new_string: "const beta = 2;",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Nearby lines:"),
    });

    try {
      await editFileTool.execute(ctx(root), {
        path: "app.ts",
        old_string: "const beta = 99;",
        new_string: "const beta = 2;",
      });
    } catch (e) {
      expect((e as Error).message).toContain("const beta = 2;");
    }
  });

  it("uses a unique, tightly bounded fuzzy fallback for a stale edit", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-edit-fuzzy-"));
    await fs.writeFile(
      path.join(root, "app.ts"),
      "export function calculateInvoiceTotal(value: number) { return value + 1; }\n",
      "utf8",
    );

    const result = await editFileTool.execute(ctx(root), {
      path: "app.ts",
      old_string:
        "export function calculateInvoiceTotals(value: number) { return value + 1; }",
      new_string:
        "export function calculateInvoiceTotal(value: number) { return value + 2; }",
    });

    expect(result.meta).toMatchObject({ matchMode: "fuzzy", replacements: 1 });
    await expect(fs.readFile(path.join(root, "app.ts"), "utf8")).resolves.toContain(
      "return value + 2",
    );
  });

  it("refuses fuzzy candidates without a unique safety margin", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nc-edit-ambiguous-"));
    await fs.writeFile(
      path.join(root, "app.ts"),
      [
        "export function calculateInvoiceTotalA(value: number) { return value + 1; }",
        "export function calculateInvoiceTotalB(value: number) { return value + 1; }",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(
      editFileTool.execute(ctx(root), {
        path: "app.ts",
        old_string:
          "export function calculateInvoiceTotalX(value: number) { return value + 1; }",
        new_string: "unsafe",
      }),
    ).rejects.toMatchObject({ name: "AmbiguousEdit", code: "ambiguous_edit" });
  });
});
