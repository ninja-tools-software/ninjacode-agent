import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HookRunner, loadHooksConfig } from "./hooks.js";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-hooks-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("loadHooksConfig", () => {
  it("defaults to disabled when no config file exists", async () => {
    const root = await tmpWorkspace();
    const config = await loadHooksConfig(root);
    expect(config.enabled).toBeFalsy();
  });

  it("reads .ninjacode/hooks.json", async () => {
    const root = await tmpWorkspace();
    await fs.mkdir(path.join(root, ".ninjacode"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".ninjacode", "hooks.json"),
      JSON.stringify({ enabled: true, hooks: { PreToolUse: [{ command: "echo hi" }] } }),
    );
    const config = await loadHooksConfig(root);
    expect(config.enabled).toBe(true);
    expect(config.hooks?.PreToolUse).toHaveLength(1);
  });
});

describe("HookRunner", () => {
  it("is disabled by default and runs nothing", async () => {
    const root = await tmpWorkspace();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const runner = new HookRunner({ enabled: false, hooks: {} }, root, permissions);
    expect(runner.enabled).toBe(false);
    const results = await runner.run({ event: "PreToolUse", sessionId: "s1", toolName: "run_shell" });
    expect(results).toEqual([]);
  });

  it("runs a matching PreToolUse hook and reports success", async () => {
    const root = await tmpWorkspace();
    // Hooks carry "shell" risk, same as run_shell — they always need approval,
    // regardless of approval mode, so this must supply an approval handler.
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const runner = new HookRunner(
      { enabled: true, hooks: { PreToolUse: [{ command: "echo hook-ran", matcher: "run_shell" }] } },
      root,
      permissions,
      async () => ({ approved: true, remember: true }),
    );
    const results = await runner.run({ event: "PreToolUse", sessionId: "s1", toolName: "run_shell" });
    expect(results).toHaveLength(1);
    expect(results[0]!.ran).toBe(true);
    expect(results[0]!.blocked).toBe(false);
    expect(results[0]!.stdout).toContain("hook-ran");
  });

  it("skips hooks whose matcher doesn't match the tool name", async () => {
    const root = await tmpWorkspace();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const runner = new HookRunner(
      { enabled: true, hooks: { PreToolUse: [{ command: "echo nope", matcher: "write_file" }] } },
      root,
      permissions,
    );
    const results = await runner.run({ event: "PreToolUse", sessionId: "s1", toolName: "run_shell" });
    expect(results).toEqual([]);
  });

  it("treats exit code 2 as a block", async () => {
    const root = await tmpWorkspace();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const runner = new HookRunner(
      { enabled: true, hooks: { PreToolUse: [{ command: "exit 2" }] } },
      root,
      permissions,
      async () => ({ approved: true }),
    );
    const results = await runner.run({ event: "PreToolUse", sessionId: "s1", toolName: "run_shell" });
    expect(results[0]!.blocked).toBe(true);
  });

  it("gates hooks through the permission engine in strict mode, requiring approval", async () => {
    const root = await tmpWorkspace();
    const permissions = new PermissionEngine(defaultPermissionPolicy("strict"));
    let approvalRequested = false;
    const runner = new HookRunner(
      { enabled: true, hooks: { PreToolUse: [{ command: "echo hi" }] } },
      root,
      permissions,
      async () => {
        approvalRequested = true;
        return { approved: false };
      },
    );
    const results = await runner.run({ event: "PreToolUse", sessionId: "s1", toolName: "run_shell" });
    expect(approvalRequested).toBe(true);
    expect(results[0]!.ran).toBe(false);
    expect(results[0]!.reason).toContain("denied");
  });

  it("does not run PostToolUse/Stop hooks under a PreToolUse-only config", async () => {
    const root = await tmpWorkspace();
    const permissions = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const runner = new HookRunner(
      { enabled: true, hooks: { PreToolUse: [{ command: "echo hi" }] } },
      root,
      permissions,
    );
    const results = await runner.run({ event: "Stop", sessionId: "s1" });
    expect(results).toEqual([]);
  });
});
