import { describe, expect, it, vi } from "vitest";
import { createDefaultToolRegistry, type Tool } from "@ninjacode/tools";
import type { ToolCall } from "@ninjacode/providers";
import { PermissionEngine, defaultPermissionPolicy } from "./permissions.js";
import { rememberGrant, resolveToolApproval, safeGrantPolicy } from "./toolPipelineHelpers.js";
import type { ApprovalRequest, RunState } from "./types.js";

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

/**
 * A risk classifier reads arguments the model wrote, so it can be made to throw.
 * When it does, the call must be treated as the worst case rather than falling
 * back to the tool's static risk, which is what the escalation exists to raise.
 */
describe("unclassifiable tool call", () => {
  function withThrowingClassifier(tool: Tool): Tool {
    return {
      ...tool,
      riskFor: () => {
        throw new Error("classifier crashed on hostile arguments");
      },
    };
  }

  function approvalDeps(permissions: PermissionEngine, onApproval?: () => Promise<{ approved: boolean }>) {
    const emitted: ApprovalRequest[] = [];
    return {
      emitted,
      deps: {
        permissions,
        onApproval,
        getState: () => "running" as RunState,
        setState: vi.fn(async () => {}),
        waitOrAbort: async <T>(promise: Promise<T>) => promise,
        isAbortError: () => false,
        emit: async (_type: "approval_required", payload: unknown) => {
          emitted.push(payload as ApprovalRequest);
        },
      },
    };
  }

  function destructiveCall(tool: Tool): { tool: Tool; tc: ToolCall; target: string } {
    return {
      tool,
      tc: { id: "call_1", name: tool.name, arguments: { command: "rm -rf ." } },
      target: "rm -rf .",
    };
  }

  it("still demands approval when the host pre-approved every tool", async () => {
    const tools = createDefaultToolRegistry();
    const shell = withThrowingClassifier(tools.get("run_shell")!);
    // `allowAllTools` in buildAgentRuntime, as used by the CLI `--yes`, the bench,
    // and the cloud worker: the whole registry is on the allowlist.
    const engine = new PermissionEngine({
      mode: "autonomous",
      allowlist: tools.names(),
      grants: new Set(),
    });
    const { deps, emitted } = approvalDeps(engine);

    const result = await resolveToolApproval({
      deps,
      ...destructiveCall(shell),
      scopes: [],
      grantPolicy: "exact",
      started: Date.now(),
    });

    expect(result.approved).toBe(false);
    expect(result.earlyReturn?.error).toBe("approval_required");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ danger: true });
  });

  it("is denied by a user in autonomous mode instead of running unattended", async () => {
    const tools = createDefaultToolRegistry();
    const shell = withThrowingClassifier(tools.get("run_shell")!);
    const engine = new PermissionEngine(defaultPermissionPolicy("autonomous"));
    const onApproval = vi.fn(async () => ({ approved: false }));
    const { deps } = approvalDeps(engine, onApproval);

    const result = await resolveToolApproval({
      deps,
      ...destructiveCall(shell),
      scopes: ["rm"],
      grantPolicy: "scoped",
      started: Date.now(),
    });

    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(result.approved).toBe(false);
    expect(result.earlyReturn?.error).toBe("user_denied");
  });

  it("is not covered by a coarse grant for the same tool", async () => {
    const tools = createDefaultToolRegistry();
    const shell = withThrowingClassifier(tools.get("run_shell")!);
    const engine = new PermissionEngine(defaultPermissionPolicy("balanced"));
    engine.grant("run_shell", "*");
    engine.grant("run_shell", "rm");
    const { deps } = approvalDeps(engine);

    const result = await resolveToolApproval({
      deps,
      ...destructiveCall(shell),
      scopes: ["rm"],
      grantPolicy: "scoped",
      started: Date.now(),
    });

    expect(result.approved).toBe(false);
  });

  it("leaves tools without a classifier on their declared risk", async () => {
    const tools = createDefaultToolRegistry();
    const read = tools.get("read_file")!;
    expect(read.riskFor).toBeUndefined();
    const engine = new PermissionEngine(defaultPermissionPolicy("strict"));
    const { deps, emitted } = approvalDeps(engine);

    const result = await resolveToolApproval({
      deps,
      tool: read,
      tc: { id: "call_2", name: "read_file", arguments: { path: "src/index.ts" } },
      target: "src/index.ts",
      scopes: [],
      grantPolicy: "exact",
      started: Date.now(),
    });

    expect(result.approved).toBe(true);
    expect(emitted).toHaveLength(0);
  });
});
