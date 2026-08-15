import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function findRepoRoot(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("repo root not found");
    dir = parent;
  }
}

const root = findRepoRoot();

describe("build purity", () => {
  it("does not bump versions from build or package scripts", () => {
    const vscode = JSON.parse(readFileSync(path.join(root, "apps/vscode/package.json"), "utf8"));
    const repo = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    expect(vscode.scripts.prebuild).toBeUndefined();
    expect(vscode.scripts.build).not.toMatch(/bump-version|version:bump/);
    expect(repo.scripts.build).not.toMatch(/version:bump/);
    expect(vscode.scripts["version:bump"]).toContain("bump-version.mjs");
    expect(vscode.version).toBe(repo.version);
  });
});
