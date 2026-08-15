import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shellTool, killShellSession, clearShellSessions } from "./shell.js";
import { ToolError } from "./types.js";
import type { ToolContext } from "./types.js";

const ctx: Omit<ToolContext, "signal"> = {
  workspaceRoot: process.cwd(),
  agentDir: process.cwd(),
  sandboxMode: "danger-full-access",
};

describe("shellTool abort", () => {
  it("rejects a oneshot command promptly when the signal aborts mid-run", async () => {
    const controller = new AbortController();
    const start = Date.now();

    const promise = shellTool.execute(
      { ...ctx, signal: controller.signal },
      { command: "sleep 30" },
    );

    setTimeout(() => controller.abort(), 100);

    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(Date.now() - start).toBeLessThan(5_000);
  }, 10_000);

  it("rejects immediately if the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      shellTool.execute({ ...ctx, signal: controller.signal }, { command: "echo hi" }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it("kills a persistent shell session and rejects the waiter on abort", async () => {
    const controller = new AbortController();
    const sessionId = `test_${Date.now()}`;
    const start = Date.now();

    try {
      const promise = shellTool.execute(
        { ...ctx, signal: controller.signal },
        { command: "sleep 30", session_id: sessionId },
      );

      setTimeout(() => controller.abort(), 100);

      await expect(promise).rejects.toMatchObject({ code: "aborted" });
      expect(Date.now() - start).toBeLessThan(5_000);
    } finally {
      killShellSession(sessionId);
    }
  }, 10_000);

  it("kills the process group when timeout_ms elapses", async () => {
    const marker = path.join(os.tmpdir(), `nc-shell-timeout-${Date.now()}`);
    const start = Date.now();
    await expect(
      shellTool.execute(
        { ...ctx, signal: AbortSignal.timeout(5_000) },
        { command: `sleep 30; echo done > ${marker}`, timeout_ms: 200 },
      ),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - start).toBeLessThan(3_000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fs.existsSync(marker)).toBe(false);
  }, 10_000);

  it("rejects cwd that is only a string-prefix sibling of the workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nc-shell-root-"));
    const sibling = `${root}-sibling`;
    fs.mkdirSync(sibling);
    try {
      await expect(
        shellTool.execute(
          { workspaceRoot: root, agentDir: root, signal: AbortSignal.timeout(5_000) },
          { command: "pwd", cwd: sibling },
        ),
      ).rejects.toMatchObject({ code: "permission" });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    clearShellSessions();
  });
});

describe("shellTool risk classification", () => {
  it("escalates an irreversible command to the destructive risk class", () => {
    expect(shellTool.riskFor!({ command: "ls -la" })).toBe("shell");
    expect(shellTool.riskFor!({ command: "rm -rf build" })).toBe("destructive");
    expect(shellTool.riskFor!({ command: "git push --force" })).toBe("destructive");
  });

  it("refuses to reduce a destructive command to a command-type grant", () => {
    expect(shellTool.grantScopes!({ command: "git status -s" })).toEqual(["git status"]);
    expect(shellTool.grantScopes!({ command: "git push --force" })).toEqual([]);
    expect(shellTool.grantScopes!({ command: "rm -rf build" })).toEqual([]);
  });
});
