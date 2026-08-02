import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyPatchTool, unifiedDiff } from "./patch.js";

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
});
