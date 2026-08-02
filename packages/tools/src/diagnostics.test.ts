import { describe, expect, it } from "vitest";
import { readLintsTool, formatDiagnostics } from "./diagnostics.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("formatDiagnostics", () => {
  it("formats entries", () => {
    const out = formatDiagnostics([
      { path: "a.ts", line: 1, column: 1, severity: "error", message: "x", source: "ts" },
    ]);
    expect(out).toContain("a.ts:1:1");
    expect(out).toContain("[ERROR]");
  });
});

describe("read_lints", () => {
  it("uses diagnostics provider when wired", async () => {
    const result = await readLintsTool.execute(
      {
        workspaceRoot: process.cwd(),
        agentDir: process.cwd(),
        diagnosticsProvider: async () => [
          { path: "foo.ts", line: 2, column: 3, severity: "warning", message: "unused" },
        ],
      },
      { path: "foo.ts" },
    );
    expect(result.output).toContain("unused");
    expect(result.meta?.warnings).toBe(1);
  });

  it("falls back to json parse check", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-lint-"));
    try {
      await fs.writeFile(path.join(dir, "bad.json"), "{ invalid", "utf8");
      const result = await readLintsTool.execute(
        { workspaceRoot: dir, agentDir: path.join(dir, ".ninjacode") },
        { path: "bad.json" },
      );
      expect(result.meta?.errors).toBeGreaterThan(0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
