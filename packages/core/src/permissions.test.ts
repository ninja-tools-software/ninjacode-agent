import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";

describe("PermissionEngine", () => {
  it("auto-approves read_only in balanced mode", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const read = tools.get("read_file")!;
    const d = engine.evaluate(read, "foo.ts");
    expect(d.allowed).toBe(true);
    expect(d.needsApproval).toBe(false);
  });

  it("requires approval for shell in balanced mode", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    const d = engine.evaluate(shell, "ls");
    expect(d.needsApproval).toBe(true);
  });

  it("auto-approves write_scratchpad in strict and balanced modes", () => {
    const tools = createDefaultToolRegistry();
    const scratchpad = tools.get("write_scratchpad")!;
    for (const mode of ["strict", "balanced"] as const) {
      const engine = new PermissionEngine(defaultPermissionPolicy(mode));
      const d = engine.evaluate(scratchpad, "scratchpad.md");
      expect(d.allowed).toBe(true);
      expect(d.needsApproval).toBe(false);
    }
  });

  it("auto-approves todo_write in strict and balanced modes", () => {
    const tools = createDefaultToolRegistry();
    const todoWrite = tools.get("todo_write")!;
    for (const mode of ["strict", "balanced"] as const) {
      const engine = new PermissionEngine(defaultPermissionPolicy(mode));
      const d = engine.evaluate(todoWrite, "todos.json");
      expect(d.allowed).toBe(true);
      expect(d.needsApproval).toBe(false);
    }
  });

  it("auto-approves a shell command whose type scope was granted", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "grep");
    const d = engine.evaluate(shell, "grep bar baz.ts", ["grep"]);
    expect(d.needsApproval).toBe(false);
    expect(d.allowed).toBe(true);
  });

  it("keeps subcommand grants specific: git status does not cover git push", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "git status");
    expect(engine.evaluate(shell, "git status -s", ["git status"]).needsApproval).toBe(false);
    expect(engine.evaluate(shell, "git push origin main", ["git push"]).needsApproval).toBe(true);
  });

  it("auto-approves a chained command only when every scope is granted", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "cat");
    expect(engine.evaluate(shell, "cat a | grep b", ["cat", "grep"]).needsApproval).toBe(true);
    engine.grant("run_shell", "grep");
    expect(engine.evaluate(shell, "cat a | grep b", ["cat", "grep"]).needsApproval).toBe(false);
  });
});
