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

  it("does not let a command-type grant cover a destructive command of that type", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "git push");
    // Granted for `git push`, but a force push rewrites remote history.
    const forced = engine.evaluate(shell, "git push --force", ["git push"], "destructive");
    expect(forced.needsApproval).toBe(true);
    expect(engine.evaluate(shell, "git push origin main", ["git push"]).needsApproval).toBe(false);
  });

  it("does not let a wildcard grant cover a destructive command", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "*");
    expect(engine.evaluate(shell, "ls -la").needsApproval).toBe(false);
    expect(engine.evaluate(shell, "rm -rf build", [], "destructive").needsApproval).toBe(true);
  });

  it("honours an exact grant for a destructive command", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    engine.grant("run_shell", "rm -rf dist");
    expect(engine.evaluate(shell, "rm -rf dist", [], "destructive").needsApproval).toBe(false);
    expect(engine.evaluate(shell, "rm -rf src", [], "destructive").needsApproval).toBe(true);
  });

  it("requires approval for a destructive shell command in autonomous mode", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    expect(engine.evaluate(shell, "rm -rf build", [], "destructive").needsApproval).toBe(true);
  });

  it("does not let the allowlist pre-approve a destructive call", () => {
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    const engine = new PermissionEngine({ mode: "autonomous", allowlist: tools.names() });
    expect(engine.evaluate(shell, "ls -la").needsApproval).toBe(false);
    expect(engine.evaluate(shell, "rm -rf build", [], "destructive").needsApproval).toBe(true);
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
