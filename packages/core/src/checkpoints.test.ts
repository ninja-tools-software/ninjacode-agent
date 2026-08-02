import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointManager } from "./checkpoints.js";

describe("CheckpointManager", () => {
  it("creates and restores checkpoints without staging node_modules", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-cp-"));
    try {
      await fs.writeFile(path.join(dir, "app.ts"), " const v = 1;\n");
      await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
      await fs.writeFile(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports=1");

      const agentDir = path.join(dir, ".ninjacode");
      const mgr = new CheckpointManager(dir, agentDir);
      await mgr.init();
      const cp1 = await mgr.create("before");

      await fs.writeFile(path.join(dir, "app.ts"), "const v = 2;\n");
      const cp2 = await mgr.create("after");
      expect(cp2.commitHash).not.toBe(cp1.commitHash);

      await mgr.restore(cp1.id);
      const content = await fs.readFile(path.join(dir, "app.ts"), "utf8");
      expect(content).toContain("v = 1");

      // node_modules should still exist (not wiped by clean of tracked files only)
      const nm = await fs.stat(path.join(dir, "node_modules", "pkg", "index.js"));
      expect(nm.isFile()).toBe(true);

      const list = await mgr.list();
      expect(list.length).toBeGreaterThanOrEqual(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("records the owning sessionId on a checkpoint", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-cp-sess-"));
    try {
      await fs.writeFile(path.join(dir, "app.ts"), "const v = 1;\n");
      const agentDir = path.join(dir, ".ninjacode");
      const mgr = new CheckpointManager(dir, agentDir);
      await mgr.init();

      const cp = await mgr.create("before", { sessionId: "sess-abc" });
      expect(cp.sessionId).toBe("sess-abc");

      const persisted = (await mgr.list()).find((c) => c.id === cp.id);
      expect(persisted?.sessionId).toBe("sess-abc");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
