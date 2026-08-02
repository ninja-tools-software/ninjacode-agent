import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { joinWorkspace, resolveInWorkspace, toWorkspaceRelative } from "./paths.js";
import { ToolError } from "./types.js";

describe("paths", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ninjacode-path-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves relative paths inside workspace", () => {
    const realRoot = fs.realpathSync(root);
    expect(resolveInWorkspace(root, "foo/bar.ts")).toBe(path.join(realRoot, "foo/bar.ts"));
  });

  it("accepts absolute paths inside workspace", () => {
    const realRoot = fs.realpathSync(root);
    const abs = path.join(root, "a/b.ts");
    expect(resolveInWorkspace(root, abs)).toBe(path.join(realRoot, "a/b.ts"));
  });

  it("rejects paths that escape workspace", () => {
    expect(() => resolveInWorkspace(root, "/etc/passwd")).toThrow(ToolError);
    expect(() => resolveInWorkspace(root, "../../outside")).toThrow(ToolError);
  });

  it("rejects symlinks that escape workspace", () => {
    const outside = path.join(os.tmpdir(), `nc-secret-${Date.now()}.txt`);
    fs.writeFileSync(outside, "SECRET");
    const link = path.join(root, "leak.txt");
    fs.symlinkSync(outside, link);
    expect(() => resolveInWorkspace(root, "leak.txt")).toThrow(ToolError);
    fs.unlinkSync(outside);
  });

  it("normalizes absolute paths to relative", () => {
    const abs = path.join(root, "fluid-sim.html");
    fs.writeFileSync(abs, "");
    expect(toWorkspaceRelative(root, abs)).toBe("fluid-sim.html");
    expect(toWorkspaceRelative(root, "src/app.ts")).toBe("src/app.ts");
  });

  it("joinWorkspace does not create nested absolute paths", () => {
    const realRoot = fs.realpathSync(root);
    const abs = path.join(root, "file.html");
    expect(joinWorkspace(root, abs)).toBe(path.join(realRoot, "file.html"));
    expect(joinWorkspace(root, "file.html")).toBe(path.join(realRoot, "file.html"));
  });
});
