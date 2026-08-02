import { describe, expect, it } from "vitest";
import type { ToolContext } from "@ninjacode/tools";
import type { ProcessRunner } from "./ports.js";
import { runVerification } from "./verify.js";

function fakeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: "/tmp/ws",
    agentDir: "/tmp/ws/.ninjacode",
    signal: undefined,
    ...overrides,
  };
}

describe("runVerification", () => {
  it("passes when no commands are configured and diagnostics are skipped", async () => {
    const result = await runVerification(
      fakeCtx(),
      { requireCleanDiagnostics: false },
      [],
    );
    expect(result).toEqual({ ok: true, messages: [] });
  });

  it("fails when a verify command exits non-zero", async () => {
    const runner: ProcessRunner = {
      async run(cmd) {
        return {
          code: cmd.includes("fail") ? 1 : 0,
          stdout: "",
          stderr: cmd.includes("fail") ? "boom" : "",
        };
      },
    };

    const result = await runVerification(
      fakeCtx(),
      { requireCleanDiagnostics: false, commands: ["pnpm test", "pnpm fail"] },
      [],
      { processRunner: runner },
    );

    expect(result.ok).toBe(false);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toContain("Verify command failed (exit 1)");
    expect(result.messages[0]).toContain("pnpm fail");
    expect(result.messages[0]).toContain("boom");
  });

  it("succeeds when all verify commands exit zero", async () => {
    const calls: string[] = [];
    const runner: ProcessRunner = {
      async run(cmd, _args, opts) {
        calls.push(cmd);
        expect(opts?.shell).toBe(true);
        expect(opts?.cwd).toBe("/tmp/ws");
        return { code: 0, stdout: "ok", stderr: "" };
      },
    };

    const result = await runVerification(
      fakeCtx(),
      { requireCleanDiagnostics: false, commands: ["echo hello"] },
      [],
      { processRunner: runner },
    );

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["echo hello"]);
  });

  it("skips diagnostic checks when no files were modified", async () => {
    const result = await runVerification(
      fakeCtx({
        diagnosticsProvider: async () => [
          { severity: "error", message: "x", path: "a.ts", line: 1, column: 1 },
        ],
      }),
      { requireCleanDiagnostics: true },
      [],
    );
    expect(result.ok).toBe(true);
  });
});
