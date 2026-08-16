import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyHunks, applyPatchTool, unifiedDiff } from "./patch.js";

describe("unifiedDiff", () => {
  it("produces a diff", () => {
    const d = unifiedDiff("a.ts", "a\nb\n", "a\nc\n");
    expect(d).toContain("--- a/a.ts");
    expect(d).toContain("-b");
    expect(d).toContain("+c");
  });
});

describe("apply_patch", () => {
  it("applies a simple unified diff", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-patch-"));
    try {
      await fs.writeFile(path.join(dir, "f.txt"), "hello\nworld\n");
      const patch = `--- a/f.txt
+++ b/f.txt
@@
 hello
-world
+ninja
`;
      const result = await applyPatchTool.execute(
        { workspaceRoot: dir, agentDir: path.join(dir, ".ninjacode") },
        { patch },
      );
      expect(result.output).toContain("f.txt");
      const content = await fs.readFile(path.join(dir, "f.txt"), "utf8");
      expect(content).toContain("ninja");
      expect(content).not.toContain("world");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects exact ambiguous context instead of editing the first match", () => {
    expect(() =>
      applyHunks("same\nmiddle\nsame\n", [{ lines: ["-same", "+changed"] }]),
    ).toThrow(/ambiguous/u);
  });

  it("rejects whitespace-normalized ambiguous context", () => {
    expect(() =>
      applyHunks("alpha  beta\nmiddle\nalpha\tbeta\n", [
        { lines: ["-alpha beta", "+changed"] },
      ]),
    ).toThrow(/ambiguous/u);
  });

  it("rejects stale context with a typed invalid-args error", () => {
    try {
      applyHunks("current\n", [{ lines: ["-stale", "+changed"] }]);
      expect.fail("expected stale patch to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_args" });
    }
  });

  it("rejects traversal paths without creating files outside the workspace", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-patch-path-"));
    const outside = path.join(path.dirname(dir), "escaped.txt");
    try {
      await expect(
        applyPatchTool.execute(
          { workspaceRoot: dir, agentDir: path.join(dir, ".ninjacode") },
          { patch: "--- /dev/null\n+++ b/../escaped.txt\n@@\n+escape\n" },
        ),
      ).rejects.toMatchObject({ code: "permission" });
      await expect(fs.stat(outside)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rm(outside, { force: true });
    }
  });

  it("rolls back earlier files when a later hunk fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-patch-rollback-"));
    try {
      await fs.writeFile(path.join(dir, "first.txt"), "before\n");
      await fs.writeFile(path.join(dir, "second.txt"), "current\n");
      const patch = `--- a/first.txt
+++ b/first.txt
@@
-before
+after
--- a/second.txt
+++ b/second.txt
@@
-stale
+changed
`;
      await expect(
        applyPatchTool.execute(
          { workspaceRoot: dir, agentDir: path.join(dir, ".ninjacode") },
          { patch },
        ),
      ).rejects.toMatchObject({ code: "invalid_args" });
      await expect(fs.readFile(path.join(dir, "first.txt"), "utf8")).resolves.toBe("before\n");
      await expect(fs.readFile(path.join(dir, "second.txt"), "utf8")).resolves.toBe("current\n");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
