import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearDebugLogsTool,
  cleanupInstrumentationTool,
  readDebugLogsTool,
  recordHypothesesTool,
  stripDebugInstrumentation,
} from "./debug.js";
import { createDefaultToolRegistry } from "./index.js";

describe("stripDebugInstrumentation", () => {
  it("removes marked blocks", () => {
    const src = `function f() {
  const x = 1;
  // NINJACODE-DEBUG-START
  fetch("http://localhost/log");
  // NINJACODE-DEBUG-END
  return x;
}
`;
    const { cleaned, removedBlocks } = stripDebugInstrumentation(src);
    expect(removedBlocks).toBe(1);
    expect(cleaned).not.toContain("NINJACODE-DEBUG");
    expect(cleaned).toContain("const x = 1");
    expect(cleaned).toContain("return x");
  });

  it("handles multiple blocks and python comments", () => {
    const src = `# NINJACODE-DEBUG-START
print("h1")
# NINJACODE-DEBUG-END
y = 1
# NINJACODE-DEBUG-START
print("h2")
# NINJACODE-DEBUG-END
`;
    const { cleaned, removedBlocks } = stripDebugInstrumentation(src);
    expect(removedBlocks).toBe(2);
    expect(cleaned.trim()).toBe("y = 1");
  });
});

describe("debug tools", () => {
  it("records hypotheses and reads filtered logs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-dtools-"));
    const agentDir = path.join(dir, ".ninjacode");
    const ctx = { workspaceRoot: dir, agentDir };
    try {
      const rec = await recordHypothesesTool.execute(ctx, {
        hypotheses: [
          { id: "H1", description: "stale cache", status: "pending" },
          { id: "H2", description: "wrong id", status: "pending" },
        ],
      });
      expect(rec.meta?.hypotheses).toHaveLength(2);

      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(agentDir, "debug.log"),
        [
          JSON.stringify({
            timestamp: "2026-01-01T00:00:00.000Z",
            hypothesisId: "H1",
            message: "a",
          }),
          JSON.stringify({
            timestamp: "2026-01-01T00:01:00.000Z",
            hypothesisId: "H2",
            message: "b",
          }),
          JSON.stringify({
            timestamp: "2026-01-01T00:02:00.000Z",
            hypothesisId: "H1",
            message: "c",
          }),
        ].join("\n") + "\n",
        "utf8",
      );

      const logs = await readDebugLogsTool.execute(ctx, { hypothesisId: "H1" });
      const parsed = JSON.parse(logs.output) as {
        total: number;
        byHypothesis: Record<string, number>;
      };
      expect(parsed.total).toBe(2);
      expect(parsed.byHypothesis).toEqual({ H1: 2 });

      await clearDebugLogsTool.execute(ctx, {});
      const after = await readDebugLogsTool.execute(ctx, {});
      expect(JSON.parse(after.output).total).toBe(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans instrumentation across files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-clean-"));
    const agentDir = path.join(dir, ".ninjacode");
    try {
      await fs.writeFile(
        path.join(dir, "a.ts"),
        `export const a = 1;\n// NINJACODE-DEBUG-START\nconsole.log("dbg");\n// NINJACODE-DEBUG-END\n`,
      );
      await fs.writeFile(
        path.join(dir, "b.py"),
        `x = 1\n# NINJACODE-DEBUG-START\nprint("dbg")\n# NINJACODE-DEBUG-END\ny = 2\n`,
      );
      await fs.writeFile(path.join(dir, "clean.ts"), `export const ok = true;\n`);

      const result = await cleanupInstrumentationTool.execute(
        { workspaceRoot: dir, agentDir },
        {},
      );
      expect(result.output).toContain("Cleaned 2 file(s)");
      const a = await fs.readFile(path.join(dir, "a.ts"), "utf8");
      const b = await fs.readFile(path.join(dir, "b.py"), "utf8");
      expect(a).not.toContain("NINJACODE-DEBUG");
      expect(a).toContain("export const a = 1");
      expect(b).not.toContain("NINJACODE-DEBUG");
      expect(b).toContain("y = 2");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("forMode debug", () => {
  it("exposes debug tools only in debug mode", () => {
    const reg = createDefaultToolRegistry();
    expect(reg.forMode("agent").get("record_hypotheses")).toBeUndefined();
    expect(reg.forMode("ask").get("read_debug_logs")).toBeUndefined();
    expect(reg.forMode("debug").get("record_hypotheses")).toBeDefined();
    expect(reg.forMode("debug").get("cleanup_instrumentation")).toBeDefined();
    expect(reg.forMode("debug").get("edit_file")).toBeDefined();
  });
});
