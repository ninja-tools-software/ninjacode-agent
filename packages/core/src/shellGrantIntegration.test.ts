import { describe, expect, it } from "vitest";
import { createDefaultToolRegistry } from "@ninjacode/tools";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { rememberGrant, safeGrantPolicy } from "./toolPipelineHelpers.js";

describe("grant then destructive shell", () => {
  it("does not reuse a bash grant for a wrapped destructive payload", () => {
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    engine.grant("run_shell", "bash");
    engine.grant("run_shell", "bash -c 'echo safe'");

    const args = { command: "bash -c 'rm -rf build'" };
    const scopes = shell.grantScopes?.(args) ?? [];
    const grantPolicy = safeGrantPolicy(shell, args, scopes);
    const decision = engine.evaluate(shell, shell.target(args), {
      scopes,
      risk: shell.riskFor?.(args),
      grantPolicy,
    });

    expect(grantPolicy).toBe("never");
    expect(scopes).toEqual([]);
    expect(decision.needsApproval).toBe(true);
  });

  it("keeps exact grants for ordinary static commands", () => {
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    const args = { command: "  git   status  -s " };
    engine.grant("run_shell", shell.target(args));
    const decision = engine.evaluate(shell, shell.target(args), {
      scopes: shell.grantScopes?.(args),
      grantPolicy: safeGrantPolicy(shell, args, shell.grantScopes?.(args) ?? []),
    });
    expect(decision.needsApproval).toBe(false);
    expect(shell.grantPolicy?.(args)).toBe("scoped");
  });

  it("remembers exact grants on the target only, never scopes", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    rememberGrant({
      permissions: engine,
      toolName: "run_shell",
      target: "git status -s",
      scopes: ["git"],
      grantPolicy: "exact",
      remember: true,
    });
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    expect(
      engine.evaluate(shell, "git status -s", { scopes: ["git"], grantPolicy: "exact" }).needsApproval,
    ).toBe(false);
    expect(
      engine.evaluate(shell, "git diff", { scopes: ["git"], grantPolicy: "scoped" }).needsApproval,
    ).toBe(true);
  });

  it("never persists a remember request when grantPolicy is never", () => {
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    rememberGrant({
      permissions: engine,
      toolName: "run_shell",
      target: "bash -c 'echo safe'",
      scopes: ["bash"],
      grantPolicy: "never",
      remember: true,
    });
    const tools = createDefaultToolRegistry();
    const shell = tools.get("run_shell")!;
    expect(
      engine.evaluate(shell, "bash -c 'echo safe'", {
        scopes: ["bash"],
        grantPolicy: "never",
      }).needsApproval,
    ).toBe(true);
  });
});
